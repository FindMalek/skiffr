/** Page-controlled text: no NUL or other control characters (tab, newline and return are fine) and no lone surrogates, which postgres would reject. */
const hasControl = (text: string) =>
  [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
  })
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

export const clean = (text: string) => !hasControl(text) && !LONE_SURROGATE.test(text)
export const CLEAN_MESSAGE = "Control characters are not allowed."
