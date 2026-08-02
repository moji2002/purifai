export const READABILITY_FIXTURES = [
  {
    name: 'document structure',
    html: '<h2>Release</h2><p>Fast <em>and</em> small.</p><p>Portable.</p>',
    readable: 'Release\n\nFast and small.\n\nPortable.',
    compact: 'Release Fast and small. Portable.',
  },
  {
    name: 'nested lists',
    html: '<ol start="3"><li>Three</li><li value="7">Seven<ul><li>Inner</li></ul></li></ol>',
    readable: '3. Three\n7. Seven\n  - Inner',
    compact: '3. Three 7. Seven - Inner',
  },
  {
    name: 'quote table and pre',
    html: '<blockquote>One<br>Two</blockquote><table><tr><td>A</td><td>B</td></tr></table><pre>\n x\n  y</pre>',
    readable: '> One\n> Two\n\nA\tB\n\n x\n  y',
    compact: 'One Two A B x y',
  },
  {
    name: 'form text',
    html: '<form><fieldset><legend>Profile</legend><label>Name <input value="secret"></label> <select><option>One</option></select> <button>Save</button></fieldset></form>',
    readable: 'Profile\n\nName One Save',
    compact: 'Profile Name One Save',
  },
  {
    name: 'breaks sections and inline code',
    html: '<section>A<br>B<hr><article>C <code>x &lt; y</code></article></section>',
    readable: 'A\nB\n\nC x < y',
    compact: 'A B C x < y',
  },
  {
    name: 'headings and nested quotes',
    html: '<h1>One</h1><h3>Three</h3><blockquote>Outer<blockquote>Inner<br>Line</blockquote>Tail</blockquote>',
    readable: 'One\n\nThree\n\n> Outer\n\n> > Inner\n> > Line\n\n> Tail',
    compact: 'One Three Outer Inner Line Tail',
  },
  {
    name: 'ordered validation and table rows',
    html: '<ol start="x"><li>One</li><li value="9007199254740992">Two</li></ol><table><tr><th>H1</th><th>H2</th></tr><tr><td>A</td><td>B</td></tr></table>',
    readable: '1. One\n2. Two\n\nH1\tH2\nA\tB',
    compact: '1. One 2. Two H1 H2 A B',
  },
  {
    name: 'empty blocks and boundary trimming',
    html: '  A<div></div><p> </p>B  ',
    readable: 'AB',
    compact: 'AB',
  },
];
