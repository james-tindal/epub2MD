import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({
  attributeNamePrefix: '@',
  ignoreAttributes: false,
  parseAttributeValue: true,
})

export const parseXml = (xml: string) =>
  xmlParser.parse(xml) as object
