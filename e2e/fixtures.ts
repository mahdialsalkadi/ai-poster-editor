import { parseDesignHtml, type DesignDoc } from '../packages/core/src/index.js';

/** Small deterministic model fixtures, rendered with the app's bundled fonts. */
export function qualityDoc(width = 600, height = 800): DesignDoc {
  return parseDesignHtml(`<div class="artboard" data-width="${width}px" data-height="${height}px" style="background:#102030">
    <div data-id="title" data-layer="English title" data-type="text" dir="ltr" style="position:absolute;left:40px;top:40px;width:${width - 80}px;font-family:Inter;font-size:40px;font-weight:700;color:#ffffff;line-height:1.2">Quality gate poster</div>
    <div data-id="arabic" data-layer="Arabic title" data-type="text" dir="rtl" style="position:absolute;left:40px;top:180px;width:${width - 80}px;font-family:Cairo;font-size:36px;font-weight:700;color:#f5a524;line-height:1.3">مرحبا بالتصميم</div>
    <div data-id="card" data-layer="Card" data-type="shape" style="position:absolute;left:40px;top:350px;width:${width - 80}px;height:140px;background:linear-gradient(90deg, #176b87 0%, #64ccc5 100%);border-radius:20px"></div>
  </div>`).doc;
}

export function visualDoc(kind: 'english' | 'arabic' | 'svg'): DesignDoc {
  const doc = qualityDoc();
  if (kind === 'english') doc.layers = doc.layers.filter((layer) => layer.id !== 'arabic');
  if (kind === 'arabic') doc.layers = doc.layers.filter((layer) => layer.id !== 'title');
  if (kind === 'svg') {
    const svg = parseDesignHtml(
      `<div class="artboard" data-width="600px" data-height="800px"><svg data-id="badge" data-layer="Gradient badge" data-type="svg" viewBox="0 0 100 100" style="position:absolute;left:140px;top:200px;width:320px;height:320px"><defs><linearGradient id="shine" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f5a524"></stop><stop offset="100%" stop-color="#f43f5e"></stop></linearGradient></defs><circle cx="50" cy="50" r="46" fill="url(#shine)" stroke="#ffffff" stroke-width="2"></circle><path d="M28 52 L44 68 L74 34" fill="none" stroke="#102030" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"></path></svg></div>`,
    ).doc;
    doc.layers = svg.layers;
    doc.background = {
      kind: 'linear',
      angle: 135,
      stops: [
        { color: '#102030', pos: 0 },
        { color: '#1f4b60', pos: 100 },
      ],
    };
  }
  return doc;
}
