// @ts-ignore
import nodeZip from 'node-zip'


export class Zip {
  private zip: NodeZip
  constructor(fileContent: Buffer) {
    this.zip = new nodeZip(fileContent, { binary: true, base64: false, checkCRC32: true })
  }
  
  getFile(path: string) {
    const path_ = decodeURI(path)
      .replace(/^\//, '') // drop initial forward slash
    const file = this.zip.file(path_)
    if (!file)
      throw new Error(`File not found in epub: ${path}`)
    return file
  }
}

interface NodeZip {
  file(path: string): {
    asText: () => string
    asNodeBuffer: () => Buffer
  }
}
