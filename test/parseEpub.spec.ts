import * as path from 'node:path'
import { get, pick } from 'lodash'
import parse from '../src/epub/parseEpub'

const baseDir = process.cwd()
const filesToBeTested = ['file-1', 'file-2', 'file-3', 'file-4', 'file-1-no-toc', 'wells']

for (const filename of filesToBeTested)
  describe(`parser 测试 ${filename}.epub`, () => {
    test('snapshot', () => {
      const filePath = path.join(baseDir, `fixtures/${filename}.epub`)
      const epub = parse(filePath)
      const snapshot = {
        ...pick(epub, ['info', '_spine']),
        structure: get(epub, ['structure', 'topLevelItems'])
      }
      expect(snapshot).toMatchSnapshot()
    })
  })
