import * as path from 'node:path'
import { pick } from 'lodash'
import parse from '../src/epub/parseEpub'

const baseDir = process.cwd()
const filesToBeTested = ['file-1', 'file-2', 'file-3', 'file-4', 'file-1-no-toc', 'wells']

for (const filename of filesToBeTested)
  describe(`parser 测试 ${filename}.epub`, () => {
    test('snapshot', async () => {
      const filePath = path.join(baseDir, `fixtures/${filename}.epub`)
      const epub = await parse(filePath)
      const snapshot = pick(epub, ['structure', 'info', '_spine'])
      expect(snapshot).toMatchSnapshot()
    })
  })
