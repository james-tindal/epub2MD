import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import _ from 'lodash'

import parseSection, { Section } from '../parseSection'
import { parseOptions, ParserOptions } from './options'
import { Zip } from './zip'
import { parseStructure, Opf, Toc } from '../xml'


export class Epub {
  private zip: Zip
  private options: ParserOptions
  private _spine?: Record<string, number>
  private opfFolder: string

  opf: Opf
  structure?: Toc
  info?: Opf['metadata']
  sections?: Section[]
  tocFile?: string

  constructor(pathOrFileContent: string | Buffer, options?: ParserOptions) {
    const { parsedOptions, zip, structure } = this.parse(pathOrFileContent, options)
    this.zip = zip
    this.options = parsedOptions
    const opf = this.opf = structure.opf
    this.opfFolder = structure.opfFolder
    this.info = opf.metadata
    this._spine = opf.spine
    this.structure = structure.toc

    this.sections = this._resolveSections()
  }

  private parse(pathOrFileContent: string | Buffer, options?: ParserOptions) {
    const { fileContent, parsedOptions } = parseOptions(pathOrFileContent, options)
    const zip = new Zip(fileContent as Buffer)
    const structure = parseStructure(zip)
    return { parsedOptions, zip, structure }
  }

  getFile(path: string) {
    const isAbsolute = path.startsWith('/')
    const absolutePath = isAbsolute
      ? path : join(this.opfFolder, path)
    return this.zip.getFile(absolutePath)
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
      const path = this.opf.manifest.getById(id)!.href
      const html = this.getFile(path).asText()
      const section = parseSection({
        id,
        htmlString: html,
        getFile: this.getFile.bind(this),
        getItemId: href => this.opf.manifest.getItemId(href),
        expand: this.options.expand,
      })

      if (this.options.convertToMarkdown) {
        section.register(this.options.convertToMarkdown)
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

export default (...args: ConstructorParameters<typeof Epub>) => new Epub(...args)
