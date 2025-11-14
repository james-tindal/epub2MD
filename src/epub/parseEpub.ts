import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import _ from 'lodash'

import type { ParserOptions } from '../types'
// @ts-ignore
import nodeZip from 'node-zip'
import parseLink from '../parseLink'
import parseSection, { Section } from '../parseSection'
import xml, { Opf, Toc } from '../xml'


export const defaultOptions = { type: "path", expand: false } as ParserOptions

export class Epub {
  private _zip: any // nodeZip instance
  // only for html/xhtml, not include images/css/js
  private _spine?: Record<string, number> // array of ids defined in manifest
  private opfFolder!: string
  private _options: ParserOptions = defaultOptions
  opf!: Opf

  structure?: Toc
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
    const tocPath = opf.manifest.find(item => item.id === 'ncx')?.href
    const toc = tocPath === undefined ? undefined :
      this.parseToc(tocPath)
    this.structure = toc

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

  parseToc(path: string) {
    const fileText = this.getFile(path).asText()
    return xml.parseToc(fileText, this.getItemId.bind(this))
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
