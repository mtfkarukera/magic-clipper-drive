window.__mc4gd_mdgen = true;
// md_generator.js — Convertisseur HTML en Markdown pour MC4GD
// Auteur : MTF Karukera | Licence : MPL-2.0
// Chargé après turndown.js et turndown-plugin-gfm.js

window.MC4GDMdGenerator = {

  /**
   * Génère un Markdown à partir du container HTML préparé par le Serializer.
   *
   * @param {HTMLElement} container - Container HTML complet (métadonnées + contenu)
   * @returns {string} Le texte Markdown final
   */
  generate(container) {
    if (typeof TurndownService === 'undefined') {
      throw new Error("TurndownService n'est pas chargé.");
    }

    // Configuration de TurndownService
    const service = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      fence: '```',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      hr: '---'
    });

    if (typeof turndownPluginGfm !== 'undefined' && typeof turndownPluginGfm.gfm === 'function') {
      service.use(turndownPluginGfm.gfm);
    }

    service.addRule('imgFallbackAlt', {
      filter: 'img',
      replacement: function(content, node) {
        const alt = node.getAttribute('alt') || node.getAttribute('title') || 'image';
        const src = node.getAttribute('src') || '';
        return src ? '![' + alt + '](' + src + ')' : '';
      }
    });

    service.remove(['script', 'style', 'noscript']);

    // 1. Extraire les métadonnées de grounding
    const metaBlock = container.querySelector('.clipper-meta');
    let metaText = '';
    
    if (metaBlock) {
      const title = metaBlock.querySelector('.meta-title')?.textContent.trim() || 'Document sans titre';
      const author = metaBlock.querySelector('.meta-author')?.textContent.trim() || '';
      const date = metaBlock.querySelector('.meta-date')?.textContent.trim() || '';
      const url = metaBlock.querySelector('a')?.href || '';
      const site = metaBlock.querySelector('div:not(.meta-label):not(.meta-title):not(.meta-author):not(.meta-date)')?.textContent.trim() || '';

      metaText += `**Métadonnées de Capture (Google Drive)**\n\n`;
      metaText += `# ${title}\n\n`;
      if (author) metaText += `${author}\n`;
      if (site) metaText += `${site}\n`;
      if (date) metaText += `${date}\n`;
      if (url) metaText += `[URL](${url})\n`;
      metaText += `\n---\n\n`;
    }

    // 2. Extraire le contenu Markdown (on ignore le header de meta dans turndown)
    // On prend le div contenant le vrai contenu, qui est le dernier enfant de clipper-reader
    const readerDiv = container.querySelector('.clipper-reader');
    let contentToConvert = readerDiv || container;
    
    // Si on a le reader, le contenu est dans le div qui suit le .clipper-meta
    if (readerDiv && metaBlock) {
       // Créer un clone du readerDiv sans le metaBlock pour la conversion
       const cloneForConversion = readerDiv.cloneNode(true);
       const metaToRemove = cloneForConversion.querySelector('.clipper-meta');
       if (metaToRemove) metaToRemove.remove();
       contentToConvert = cloneForConversion;
    }

    let markdownContent = service.turndown(contentToConvert);

    // 3. Assembler et nettoyer les lignes vides multiples
    let finalMarkdown = metaText + markdownContent;
    finalMarkdown = finalMarkdown.replace(/\n{3,}/g, '\n\n').trim();

    return finalMarkdown;
  }
};
