import { describe, expect, it } from 'vitest';
import { SecurityViolationError, parseDesignHtml } from '../src/index';

const artboard = (inner: string, style = 'background:#ffffff'): string =>
  `<div class="artboard" data-width="400px" data-height="400px" style="${style}">${inner}</div>`;

const GEOMETRY = 'position:absolute;left:0px;top:0px;width:10px;height:10px';

const shape = (attrs = '', style = ''): string =>
  `<div data-id="l1" data-layer="L1" data-type="shape" ${attrs} style="${GEOMETRY};${style}"></div>`;

const text = (content: string, attrs = '', style = ''): string =>
  `<div data-id="l1" data-layer="L1" data-type="text" ${attrs} style="position:absolute;left:0px;top:0px;width:10px;${style}">${content}</div>`;

const svg = (inner: string, attrs = ''): string =>
  `<svg data-id="l1" data-layer="L1" data-type="svg" ${attrs} style="${GEOMETRY}">${inner}</svg>`;

const expectRejected = (html: string): void => {
  expect(() => parseDesignHtml(html)).toThrow(SecurityViolationError);
};

describe('security rejection corpus: forbidden tags', () => {
  const cases: Array<[string, string]> = [
    ['script', '<script>alert(1)</script>'],
    ['style', '<style>body{color:red}</style>'],
    ['link', '<link rel="stylesheet" href="https://evil.test/a.css">'],
    ['iframe', '<iframe src="https://evil.test"></iframe>'],
    ['form', '<form action="https://evil.test"><input></form>'],
    ['input', '<input value="x">'],
    ['object', '<object data="https://evil.test/a.swf"></object>'],
    ['embed', '<embed src="https://evil.test/a.swf">'],
    ['meta', '<meta http-equiv="refresh" content="0;url=https://evil.test">'],
    ['base', '<base href="https://evil.test/">'],
    ['template', '<template><script>alert(1)</script></template>'],
    ['math', '<math><mi>x</mi></math>'],
    ['video', '<video src="https://evil.test/a.mp4"></video>'],
  ];

  it.each(cases)('rejects <%s> anywhere in the artboard', (_name, inner) => {
    expectRejected(artboard(inner));
  });

  it.each(cases)('rejects <%s> nested inside a layer', (_name, inner) => {
    expectRejected(artboard(shape('', '').replace('></div>', `>${inner}</div>`)));
  });

  it.each([
    ['foreignObject', '<foreignObject><div>x</div></foreignObject>'],
    ['use', '<use href="#a"></use>'],
    ['image', '<image href="https://evil.test/a.png"></image>'],
    ['animate', '<animate attributeName="x" to="1"></animate>'],
    ['set', '<set attributeName="x" to="1"></set>'],
    ['filter', '<filter id="f"></filter>'],
  ])('rejects SVG <%s>', (_name, inner) => {
    expectRejected(artboard(svg(inner)));
  });
});

describe('security rejection corpus: attributes', () => {
  it.each([
    'onclick="alert(1)"',
    'onerror="alert(1)"',
    'onload="alert(1)"',
    'onmouseover="alert(1)"',
    'ONCLICK="alert(1)"',
    'onpointerdown="alert(1)"',
  ])('rejects event handler %s', (attr) => {
    expectRejected(artboard(shape(attr)));
  });

  it.each([
    ['plain href', 'href="https://evil.test"'],
    ['xlink href', 'xlink:href="https://evil.test"'],
    ['srcset', 'srcset="https://evil.test/a.png 1x"'],
    ['formaction', 'formaction="https://evil.test"'],
  ])('rejects forbidden URL attribute: %s', (_name, attr) => {
    expectRejected(artboard(shape(attr)));
  });

  it.each([
    ['https', 'https://evil.test/a.png'],
    ['http', 'http://evil.test/a.png'],
    ['protocol relative', '//evil.test/a.png'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data uri', 'data:image/png;base64,AAAA'],
    ['file scheme', 'file:///C:/secret.png'],
    ['space padded protocol relative', '  //evil.test/a.png'],
  ])('rejects image src with %s', (_name, src) => {
    expectRejected(
      artboard(
        `<img data-id="l1" data-layer="L1" data-type="image" src="${src}" style="${GEOMETRY}">`,
      ),
    );
  });

  it('accepts the asset: scheme for image layers', () => {
    const { doc } = parseDesignHtml(
      artboard(
        `<img data-id="l1" data-layer="L1" data-type="image" src="asset:hero_1" style="${GEOMETRY}">`,
      ),
    );
    expect(doc.layers[0]?.type).toBe('image');
  });
});

describe('security rejection corpus: CSS values', () => {
  it.each([
    ['plain url()', 'background:url(https://evil.test/a.png)'],
    ['uppercase URL()', 'background:URL(https://evil.test/a.png)'],
    ['escaped u in url', 'background:u\\72l(https://evil.test/a.png)'],
    ['fully escaped url', 'background:\\75rl(https://evil.test/a.png)'],
    ['escaped url with local ref', 'background:\\75rl(#x)'],
    ['protocol relative url', 'background:url(//evil.test/a.png)'],
    ['CSS @import', 'font-family:@import'],
    ['CSS expression()', 'width:expression(alert(1))'],
    ['javascript: scheme', 'background:javascript:alert(1)'],
    ['escaped javascript scheme', 'background:j\\61vascript:alert(1)'],
  ])('rejects %s in a style attribute', (_name, style) => {
    expectRejected(artboard(shape('', style)));
  });

  it.each([
    ['style tag', '<style>@import url(https://evil.test/a.css);</style>'],
    ['link rel import', '<link rel="import" href="https://evil.test/a.html">'],
  ])('rejects %s', (_name, inner) => {
    expectRejected(artboard(inner));
  });

  it('rejects a url() in the artboard background', () => {
    expectRejected(artboard('', 'background:url(https://evil.test/a.png)'));
  });

  it('rejects escaped CSS in text spans', () => {
    expectRejected(
      artboard(text('<span style="background:\\75rl(https://evil.test/a.png)">x</span>')),
    );
  });
});

describe('security rejection corpus: SVG paint references', () => {
  it.each([
    ['remote https', 'url(https://evil.test/x.svg#a)'],
    ['protocol relative', 'url(//evil.test/x.svg#a)'],
    ['javascript scheme', 'url(javascript:alert(1))'],
    ['escaped protocol relative url', 'url(\\2f\\2fevil.test/x.svg#a)'],
    ['data uri', 'url(data:image/png;base64,AAAA)'],
  ])('rejects fill with %s', (_name, value) => {
    expectRejected(artboard(svg(`<path d="M0 0" fill="${value}"></path>`)));
  });

  it('rejects stroke with a remote reference', () => {
    expectRejected(artboard(svg('<path d="M0 0" stroke="url(https://evil.test/x#a)"></path>')));
  });

  it('rejects style attributes inside SVG', () => {
    expectRejected(artboard(svg('<path d="M0 0" style="fill:url(https://evil.test/x)"></path>')));
  });

  it('rejects href inside SVG', () => {
    expectRejected(artboard(svg('<path d="M0 0" href="https://evil.test/x"></path>')));
  });

  it('rejects event attributes inside SVG', () => {
    expectRejected(artboard(svg('<path d="M0 0" onclick="alert(1)"></path>')));
  });
});

describe('security rejection corpus: markup smuggling', () => {
  it('rejects a script split with comments across the artboard', () => {
    // The HTML tokenizer turns this into an unknown element, never a script:
    // the document is still rejected, as an invalid layer rather than a tag ban.
    expect(() => parseDesignHtml(artboard('<scr<!--x-->ipt>alert(1)</scr<!--x-->ipt>'))).toThrow();
  });

  it('rejects a script hidden inside a text layer', () => {
    expectRejected(artboard(text('<script>alert(1)</script>')));
  });

  it('rejects a script inside an SVG text layer', () => {
    expectRejected(artboard(svg('<title><script>alert(1)</script></title>')));
  });
});
