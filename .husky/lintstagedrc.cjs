module.exports = {
  '*.{js,jsx,ts,tsx}': ['eslint --fix', 'prettier --write'],
  // .npmrc 为 INI 格式而非 JSON，强制 json parser 会解析失败，故从该规则中排除
  '{!(package)*.json,*.code-snippets,.!(browserslist|npm)*rc}': ['prettier --parser json --write'],
  'package.json': ['prettier --write'],
  '*.vue': ['prettier --write', 'stylelint --fix'],
  '*.{scss,less,styl,css,html}': ['stylelint --fix', 'prettier --write'],
  '*.md': ['prettier --write']
}
