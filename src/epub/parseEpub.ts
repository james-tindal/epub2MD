import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import _ from 'lodash'

import type { ParserOptions, GeneralObject } from '../types'
// @ts-ignore
import nodeZip from 'node-zip'
import parseLink from '../parseLink'
import parseSection, { Section } from '../parseSection'
import { parseXml } from '../xml/parseXml'
import xml, { Opf } from '../xml'


export const defaultOptions = { type: "path", expand: false } as ParserOptions

export interface TOCItem {
  name: string
  sectionId: string
  nodeId: string
  path: string
  playOrder: number | string
  children?: TOCItem[]
}

export class Epub {
  private _zip: any // nodeZip instance
  // only for html/xhtml, not include images/css/js
  private _spine?: Record<string, number> // array of ids defined in manifest
  private opfFolder!: string
  private _toc?: GeneralObject
  private _options: ParserOptions = defaultOptions
  opf!: Opf

  structure?: TOCItem[]
  info?: Opf['metadata']
  sections?: Section[]
  tocFile?: string

  constructor(buffer: Buffer, options?: ParserOptions) {
    this._zip = new nodeZip(buffer, { binary: true, base64: false, checkCRC32: true })
    if (options) this._options = { ...defaultOptions, ...options }
  }

  parse() {
    const { opfPath, opfFolder } = this.parseMetaContainer()
    this.opfFolder = opfFolder
    const opf = this.opf = this.parseOpf(opfPath)
    this.info = opf.metadata
    this._spine = opf.spine

    // https://github.com/gaoxiaoliangz/epub-parser/issues/13
    // https://www.w3.org/publishing/epub32/epub-packages.html#sec-spine-elem
    this.tocFile = (_.find(opf.manifest, { id: 'ncx' }) || {}).href
    if (this.tocFile) {
      const toc = this.getXmlFile(this.tocFile)
      this._toc = toc
      this.structure = this._genStructure(toc)
    }

    this.sections = this._resolveSections()

    return this
  }
  
  parseMetaContainer() {
    const fileText = this.getFile('/META-INF/container.xml').asText()
    return xml.parseMetaContainer(fileText)
  }

  parseOpf(path: string) {
    const fileText = this.getFile('/' + path).asText()
    return xml.parseOpf(fileText)
  }

  getFile(path: string): {
    asText: () => string
    asNodeBuffer: () => Buffer
  } {
    let _path
    if (path[0] === '/') {
      // use absolute path, root is zip root
      _path = path.substr(1)
    } else {
      _path = this.opfFolder + path
    }
    const file = this._zip.file(decodeURI(_path))
    if (file) {
      return file
    } else {
      throw new Error(`${_path} not found!`)
    }
  }

  private getXmlFile(path: string): GeneralObject {
    const xml = this.getFile(path).asText()
    return parseXml(xml)
  }

  /**
   * Resolves the item ID from a given href link in the EPUB manifest.
   *
   * @param {string} href - The href link to resolve the item ID for.
   * @returns {string} The corresponding item ID from the manifest.
   */
  getItemId(href: string) {
    const { name: tarName } = parseLink(href)
    const tarItem = this.opf.manifest.find(item => {
      const { name } = parseLink(item.href)
      return name === tarName
    })
    return tarItem?.id!
  }

  /** for toc is toc.html  */
  private _genStructureForHTML(tocObj: GeneralObject) {
    const tocRoot = tocObj.html.body[0].nav[0]['ol'][0].li
    let runningIndex = 1

    const parseHTMLNavPoints = (navPoint: GeneralObject) => {
      const element = navPoint.a[0] || {}
      const path = element['$'].href
      let name = element['_']
      const prefix = element.span
      if (prefix) {
        name = `${prefix.map((p: GeneralObject) => p['_']).join('')}${name}`
      }
      const sectionId = this.getItemId(path)
      const { hash: nodeId } = parseLink(path)
      const playOrder = runningIndex

      let children = navPoint?.ol?.[0]?.li

      if (children) {
        children = parseOuterHTML(children)
      }

      runningIndex++

      return {
        name,
        sectionId,
        nodeId,
        path,
        playOrder,
        children,
      }
    }

    const parseOuterHTML = (collection: GeneralObject[]) => {
      return collection.map((point) => parseHTMLNavPoints(point))
    }

    return parseOuterHTML(tocRoot)
  }

  /**
   * Generates a structured table of contents from the EPUB's navigation data
   * @param tocObj - The table of contents object from the EPUB file
   * @param resolveNodeId - Optional flag to resolve node IDs
   * @returns Array of TOCItem objects representing the hierarchical structure
   * @internal
   */
  _genStructure(tocObj: GeneralObject, resolveNodeId = false): TOCItem[] {
    if (tocObj.html) {
      return this._genStructureForHTML(tocObj)
    }

    // may be GeneralObject or GeneralObject[] or []
    const rootNavPoints = _.get(tocObj, ['ncx', 'navMap', 'navPoint'], [])
    const parseNavPoint = (navPoint: GeneralObject) => {
      // link to section
      const path = _.get(navPoint, ['content', '@src'], '')
      const name = _.get(navPoint, ['navLabel', 'text'])

      const playOrder = _.get(navPoint, ['@playOrder']) as string
      const { hash } = parseLink(path)

      let children = navPoint.navPoint
      if (children) {
        // tslint:disable-next-line:no-use-before-declare
        children = parseNavPoints(children)
      }

      const sectionId = this.getItemId(path)

      return {
        name,
        sectionId,
        nodeId: hash || navPoint['@id'],
        path,
        playOrder,
        children,
      }
    }

    const parseNavPoints = (navPoints: GeneralObject[]) => {
      // check if it's array or not
      return (Array.isArray(navPoints) ? navPoints : [navPoints])
        .map((point) => parseNavPoint(point))
    }

    return parseNavPoints(rootNavPoints)
  }

  /**
   * Resolves and parses sections of an EPUB document.
   *
   * @param {string} [id] - Optional specific section ID to resolve. If not provided, resolves all sections.
   * @returns {Section[]} An array of parsed document sections.
   * ```example
   * Section {
   *  id: "chapter_104",
   *  htmlString: "...",
   *  htmlObjects: [
   *    {
   *      tag: "p",
   *      content: "...",
   *      attributes: {
   *        class: "paragraph"
   *      }
   *    }
   *  ]
   *  ...
   * }[]
   * ```
   * @private
   */
  private _resolveSections(id?: string) {
    let list: any[] = _.union(Object.keys(this.opf.spine!))
    // no chain
    if (id) {
      list = [id];
    }
    return list.map((id) => {
      const path = this.opf.manifest.find(item => item.id === id)!.href
      const html = this.getFile(path).asText()
      const section = parseSection({
        id,
        htmlString: html,
        getFile: this.getFile.bind(this),
        getItemId: this.getItemId.bind(this),
        expand: this._options.expand,
      })

      if (this._options.convertToMarkdown) {
        section.register(this._options.convertToMarkdown)
      }
      return section
    })
  }

  getSection(id: string): Section | null {
    let sectionIndex = -1
    if (this.opf.spine) sectionIndex = this.opf.spine[id]
    // fix other html ont include spine structure
    if (sectionIndex === undefined) {
      return this._resolveSections(id)[0]
    }
    return this.sections ? sectionIndex != -1 ? this.sections[sectionIndex] : null : null
  }
}

export default function parserWrapper(target: string | Buffer, opts?: ParserOptions) {
  // seems 260 is the length limit of old windows standard
  // so path length is not used to determine whether it's path or binary string
  // the downside here is that if the filepath is incorrect, it will be treated as binary string by default
  // but it can use options to define the target type
  const options = { ...defaultOptions, ...opts }
  let _target = target
  if (options.type === 'path' || (typeof target === 'string' && fs.existsSync(target))) {
    _target = fs.readFileSync(target as string, 'binary')
  }
  return new Epub(_target as Buffer, options).parse()
}
