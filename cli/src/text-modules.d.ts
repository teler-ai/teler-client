/** Files imported with `with { type: 'text' }` are bundled as strings. */
declare module '*.md' {
  const text: string
  export default text
}
