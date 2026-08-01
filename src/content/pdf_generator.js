window.__mc4gd_pdfgen = true;
// pdf_generator.js — Rôle : dom-to-pdf-converter (jsPDF)

/**
 * Aplatit un tableau HTML contenant des colspan et rowspan pour produire une grille 2D.
 * Duplication volontaire pour environnement Firefox MV3 sans bundler.
 *
 * @param {HTMLElement} tableNode - Nœud DOM de la table.
 * @returns {Object} Un objet { head: Object[][], body: Object[][] } contenant les lignes aplaties.
 */
function flattenTable(tableNode) {
  if (!tableNode) return { head: [], body: [] };
  
  const rows = Array.from(tableNode.querySelectorAll('tr'));
  if (rows.length === 0) return { head: [], body: [] };

  const grid = [];
  const isHeaderRow = [];

  for (let r = 0; r < rows.length; r++) {
    const rowEl = rows[r];
    grid[r] = grid[r] || [];
    
    // FIX : isHead est strictement réservé aux lignes contenues dans un <thead> HTML natif,
    // ou uniquement à la 1ère ligne (r === 0) si elle ne contient que des <th>.
    const isInThead = (rowEl.parentElement && rowEl.parentElement.tagName.toLowerCase() === 'thead');
    const isFirstRowOnlyTh = (r === 0 && rowEl.querySelector('th') !== null && rowEl.querySelector('td') === null);
    const isHead = isInThead || isFirstRowOnlyTh;
    isHeaderRow[r] = isHead;

    const cells = Array.from(rowEl.querySelectorAll('th, td'));
    let col = 0;

    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];

      while (grid[r][col] !== undefined) {
        col++;
      }

      const colspan = parseInt(cell.getAttribute('colspan'), 10) || 1;
      const rowspan = parseInt(cell.getAttribute('rowspan'), 10) || 1;

      const content = cell.textContent.trim()
                          .replace(/\n/g, ' ')
                          .replace(/\|/g, '\\|');

      // Cellule Origine de la zone de fusion M x N
      grid[r][col] = {
        text: content,
        spanW: colspan,
        spanH: rowspan,
        isOrigin: true
      };

      // Marquer TOUTES les autres cellules couvertes par cette zone (horizontales et verticales)
      for (let hr = 0; hr < rowspan; hr++) {
        for (let wc = 0; wc < colspan; wc++) {
          if (hr === 0 && wc === 0) continue; // ignorer la cellule origine
          const targetR = r + hr;
          const targetC = col + wc;
          grid[targetR] = grid[targetR] || [];
          grid[targetR][targetC] = { isCovered: true, originR: r, originC: col };
        }
      }

      col += colspan;
    }
  }

  let maxCols = 0;
  for (let r = 0; r < grid.length; r++) {
    if (grid[r].length > maxCols) {
      maxCols = grid[r].length;
    }
  }

  // AUTO-COLSPAN : Réservé STRICTEMENT aux lignes de note 
  // (1 seule cellule origine, et AUCUNE cellule couverte par un rowspan venant du dessus)
  for (let r = 0; r < grid.length; r++) {
    let hasCovered = false;
    let originCellC = -1;

    for (let c = 0; c < maxCols; c++) {
      if (grid[r][c] && grid[r][c].isCovered) hasCovered = true;
      if (grid[r][c] && grid[r][c].isOrigin) originCellC = c;
    }

    if (!hasCovered && originCellC === 0) {
      const originCells = (grid[r] || []).filter(cell => cell && cell.isOrigin);
      if (originCells.length === 1 && maxCols > 1) {
        const firstCell = originCells[0];
        if (firstCell && firstCell.spanW === 1) {
          firstCell.spanW = maxCols;
          for (let c = 1; c < maxCols; c++) {
            grid[r][c] = { isCovered: true, originR: r, originC: 0 };
          }
        }
      }
    }
  }

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < maxCols; c++) {
      if (grid[r][c] === undefined) {
        grid[r][c] = { text: '', spanW: 1, spanH: 1, isOrigin: true };
      }
    }
  }

  const head = [];
  const body = [];

  for (let r = 0; r < grid.length; r++) {
    if (isHeaderRow[r]) {
      head.push(grid[r]);
    } else {
      body.push(grid[r]);
    }
  }

  if (head.length === 0 && grid.length > 0) {
    head.push(grid[0]);
    body.shift();
  }

  return { head, body };
}

// VERSION MC4GD : jsPDF amélioré — images data URI, tables visuelles, contenu Readability
//
// Ce module reçoit un container HTML préparé par le Serializer
// Il parcourt le DOM du container et génère un PDF structuré via jsPDF.

window.MC4GDPdfGenerator = {

  /**
   * Sanitise une chaîne pour éviter le débordement horizontal jsPDF (espaces insécables & mots géants)
   */
  _sanitizeText(str) {
    if (!str) return '';
    let cleaned = str.replace(/[^\x20-\x7E\u00C0-\u024F\u1E00-\u1EFF.,;:!?'"«»""''()\-–—/\\@#€$£¥%&*+=<>{}[\]°…\n²³¹]/g, ' ');
    cleaned = cleaned.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ');
    // Insérer un espace de césure après la ponctuation ou parenthèses collées
    cleaned = cleaned.replace(/([\/\-\(\)\[\]])/g, '$1 ');
    // Sécurité anti-débordement horizontal : forcer une rupture tous les 20 caractères ininterrompus
    cleaned = cleaned.replace(/(\S{20})/g, '$1 ');
    return cleaned.trim();
  },

  /**
   * Génère un PDF à partir du container HTML du Serializer.
   *
   * @param {HTMLElement} container - Container avec CSS Reader Mode + data URI images.
   * @returns {Promise<string>} PDF en Base64 Data URI.
   */
  async generate(container) {
    // Extraire les blocs du container HTML
    const blocks = this._extractBlocks(container);

    // Initialiser jsPDF
    const jsPDFCtor = (typeof jspdf !== 'undefined' && jspdf.jsPDF) ? jspdf.jsPDF :
                      (typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF) ? window.jspdf.jsPDF : null;

    if (!jsPDFCtor) {
      throw new Error("jsPDF non chargé. Vérifiez lib/jspdf.umd.min.js dans le manifest.");
    }

    const doc = new jsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();

    /** Constantes de mise en page — toutes les valeurs magiques centralisées ici. */
    const PDF_LAYOUT = {
      margin:    15,       // marge en mm (haut, bas, gauche, droite)
      font: {
        meta:    9,        // taille pour les métadonnées (auteur, date, URL)
        body:    10,       // taille corps de texte standard
        caption: 11,       // taille pour titres de section meta
        h3:      12,       // h3-h6
        h2:      14,       // h2
        h1:      16,       // h1
        table:   8,        // taille pour les cellules de tableau
      },
      image: {
        maxWidth:  null,   // calculé dynamiquement : uw
        maxHeight: null,   // calculé dynamiquement : ph - margin*2 - 10
        gap:       5,      // espace après image (mm)
      },
      line: {
        gap:       4,      // espace après séparateur <hr>
        urlGap:    6,      // espace après lien URL
      },
      table: {
        cellPadX:  2,      // padding horizontal cellule
        cellPadY:  1.5,    // padding vertical cellule
        minColW:   10,     // largeur min colonne (mm)
      },
    };

    const m   = PDF_LAYOUT.margin;
    const uw  = pw - m * 2; // largeur utilisable
    let y = m; // curseur vertical

    // --- Helpers ---
    const newPage = (orientation) => {
      if (orientation) {
        doc.addPage('a4', orientation);
      } else {
        doc.addPage('a4', 'portrait');
      }
      y = m;
    };
    const space = (needed) => { if (y + needed > ph - m) newPage(); };
    const sanitizeText = (str) => this._sanitizeText(str);

    const addText = (text, size, bold, spacing, color) => {
      if (!text) return;
      const cleanStr = sanitizeText(text);
      color = color || [50, 50, 50];
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setTextColor(color[0], color[1], color[2]);
      const lines = doc.splitTextToSize(cleanStr, uw);
      const lh = size * 0.4;
      for (const rawLine of lines) {
        // Double-sécurité anti-débordement horizontal
        const line = sanitizeText(rawLine);
        space(lh);
        doc.text(line, m, y);
        y += lh;
      }
      y += (spacing || 2);
    };

    const addRule = () => {
      space(5);
      doc.setDrawColor(180, 180, 180);
      doc.line(m, y, pw - m, y);
      y += 4;
    };

    // --- Rendu des blocs ---
    for (const block of blocks) {
      switch (block.type) {

        case 'meta-title':
          addText(`— Métadonnées de Capture (Google Drive) —`, 11, true, 3, [80, 80, 80]);
          addText(block.text, 10, true, 2, [50, 50, 50]);
          break;

        case 'meta-info':
          addText(block.text, 9, false, 1, [100, 100, 100]);
          break;

        case 'meta-url':
          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(26, 115, 232);
          space(5);
          doc.textWithLink(block.text, m, y, { url: block.text });
          y += 6;
          addRule();
          break;

        case 'h1':
          y += 3;
          addText(block.text, 16, true, 4, [20, 20, 20]);
          break;
        case 'h2':
          y += 2;
          addText(block.text, 14, true, 3, [30, 30, 30]);
          break;
        case 'h3': case 'h4': case 'h5': case 'h6':
          y += 1;
          addText(block.text, 12, true, 2, [40, 40, 40]);
          break;

        case 'li':
          addText('  •  ' + block.text, 10, false, 1.5, [50, 50, 50]);
          break;

        case 'image': {
          if (!block.data) break;
          try {
            const imgW = block.width || 400;
            const imgH = block.height || 300;
            const maxW = uw;
            const maxH = ph - m * 2 - 10;
            const ratio = Math.min(maxW / imgW, maxH / imgH, 1);
            const fw = imgW * ratio;
            const fh = imgH * ratio;
            space(fh + 5);
            const xOff = m + (uw - fw) / 2;
            doc.addImage(block.data, 'JPEG', xOff, y, fw, fh);
            y += fh + 5;
          } catch (e) {
            console.warn('[MC4GD] Image ignorée:', e.message);
          }
          break;
        }

        case 'table':
          this._renderTable(doc, block, m, uw, ph, () => y, (v) => { y = v; }, space, newPage);
          break;

        case 'hr':
          addRule();
          break;

        case 'p': default:
          if (block.text) addText(block.text, 10, false, 2, [50, 50, 50]);
          break;
      }
    }

    const result = doc.output('datauristring');
    return result;
  },

  // =================================================================
  // _renderTable : Table visuelle unifiée (isOrigin / isCovered & anti-débordement)
  // =================================================================
  _renderTable(doc, block, m, uw, ph, getY, setY, space, newPage) {
    const allRows = [...(block.head || []), ...(block.body || [])];
    if (allRows.length === 0) return;

    let maxCols = 0;
    for (const row of allRows) {
      if (row.length > maxCols) maxCols = row.length;
    }
    if (maxCols === 0) return;

    // 1. Basculement automatique en mode Paysage si tableau géant (>= 8 colonnes)
    let isLandscape = false;
    let effectiveUw = uw;
    let effectivePh = ph;

    if (maxCols >= 8) {
      isLandscape = true;
      newPage('landscape');
      effectiveUw = 297 - m * 2; // 267mm utiles en A4 Paysage
      effectivePh = 210;
    }

    const fontSize = isLandscape ? 7 : 8;
    const cellPadX = isLandscape ? 1.5 : 2;
    const cellPadY = 1.5;
    const lh = fontSize * 0.4;

    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'normal');

    const getCellMeta = (cell) => {
      if (cell && typeof cell === 'object') {
        return {
          text: cell.text || '',
          spanW: cell.spanW || 1,
          spanH: cell.spanH || 1,
          isOrigin: !!cell.isOrigin,
          isCovered: !!cell.isCovered
        };
      }
      return { text: (cell || '').toString(), spanW: 1, spanH: 1, isOrigin: true, isCovered: false };
    };

    // 2. Calcul de la Largeur Naturelle (W_nat) par colonne
    const colWNat = new Array(maxCols).fill(0);
    const absoluteMinColW = 5;

    for (let c = 0; c < maxCols; c++) {
      let maxW = absoluteMinColW;
      for (const row of allRows) {
        const meta = getCellMeta(row[c]);
        if (meta.spanW > 1 || meta.isCovered) continue;

        const txt = this._sanitizeText(meta.text);
        const tw = doc.getTextWidth(txt) + cellPadX * 2;
        if (tw > maxW) maxW = tw;
      }
      colWNat[c] = maxW;
    }

    // 2.bis. Ajustement de largeur pour les colspans
    for (let r = 0; r < allRows.length; r++) {
      const row = allRows[r];
      for (let c = 0; c < maxCols; c++) {
        const meta = getCellMeta(row[c]);
        if (meta.isOrigin && meta.spanW > 1) {
          const txt = this._sanitizeText(meta.text);
          const tw = doc.getTextWidth(txt) + cellPadX * 2;
          
          let currentSpanW = 0;
          for (let i = 0; i < meta.spanW && (c + i) < maxCols; i++) {
            currentSpanW += colWNat[c + i];
          }
          
          if (tw > currentSpanW) {
            const extra = tw - currentSpanW;
            const extraPerCol = extra / Math.min(meta.spanW, maxCols - c);
            for (let i = 0; i < meta.spanW && (c + i) < maxCols; i++) {
              colWNat[c + i] += extraPerCol;
            }
          }
        }
      }
    }

    const totalNatW = colWNat.reduce((a, b) => a + b, 0);
    const densityRatio = totalNatW / effectiveUw;

    // Décision d'Alignement & Largeur (Indicateur de Densité à 50%)
    const colW = [...colWNat];
    let startX = m;
    let tableW = effectiveUw;

    if (densityRatio >= 0.50 || totalNatW >= effectiveUw) {
      // MODE PLEINE LARGEUR (100% de effectiveUw, aligné à m)
      tableW = effectiveUw;
      startX = m;
      if (totalNatW > effectiveUw) {
        const scale = effectiveUw / totalNatW;
        for (let c = 0; c < maxCols; c++) {
          colW[c] *= scale; // Strictement proportionnel, aucun Math.max
        }
      } else if (totalNatW < effectiveUw && totalNatW > 0) {
        const extraPerCol = (effectiveUw - totalNatW) / maxCols;
        for (let c = 0; c < maxCols; c++) {
          colW[c] += extraPerCol;
        }
      }
    } else {
      // MODE CENTRÉ - ADAPTATIF (Compact aéré, centré horizontalement)
      tableW = Math.min(effectiveUw, Math.max(absoluteMinColW * maxCols, totalNatW * 1.15));
      startX = m + (effectiveUw - tableW) / 2;
      const scale = tableW / totalNatW;
      for (let c = 0; c < maxCols; c++) {
        colW[c] *= scale;
      }
    }

    const headCount = (block.head || []).length;

    // 3. PASSE 1 : Calcul de la hauteur propre de chaque ligne (rowHeights[r])
    const rowHeights = [];
    const cellLinesMatrix = [];

    for (let r = 0; r < allRows.length; r++) {
      const row = allRows[r];
      const lineMap = [];
      let maxLinesInRow = 1;

      for (let c = 0; c < maxCols; c++) {
        const meta = getCellMeta(row[c]);
        if (meta.isCovered || !meta.isOrigin) {
          lineMap.push([]);
          continue;
        }

        let availW = 0;
        for (let i = 0; i < meta.spanW && (c + i) < maxCols; i++) {
          availW += colW[c + i];
        }
        availW -= cellPadX * 2;

        const txt = this._sanitizeText(meta.text);
        const lines = doc.splitTextToSize(txt, Math.max(availW, 5));
        lineMap.push(lines);

        if (meta.spanH === 1 && lines.length > maxLinesInRow) {
          maxLinesInRow = lines.length;
        }
      }

      cellLinesMatrix.push(lineMap);
      rowHeights[r] = maxLinesInRow * lh + cellPadY * 2;
    }

    // 3.5. PASSE 1.5 : Ajustement des hauteurs pour les rowspan (spanH > 1)
    for (let r = 0; r < allRows.length; r++) {
      for (let c = 0; c < maxCols; c++) {
        const meta = getCellMeta(allRows[r][c]);
        if (meta.isOrigin && meta.spanH > 1) {
          const lines = cellLinesMatrix[r][c] || [];
          const requiredH = lines.length * lh + cellPadY * 2;
          
          let currentH = 0;
          for (let k = 0; k < meta.spanH && (r + k) < allRows.length; k++) {
            currentH += rowHeights[r + k];
          }
          
          if (requiredH > currentH) {
            const extra = requiredH - currentH;
            const extraPerRow = extra / Math.min(meta.spanH, allRows.length - r);
            for (let k = 0; k < meta.spanH && (r + k) < allRows.length; k++) {
              rowHeights[r + k] += extraPerRow;
            }
          }
        }
      }
    }

    // 4. PASSE 2 : Dessin et gestion des fusions (rowspan & colspan)
    let curY = getY();

    for (let r = 0; r < allRows.length; r++) {
      const isHead = r < headCount;
      const rowH = rowHeights[r];

      if (curY + rowH > effectivePh - m) {
        newPage(isLandscape ? 'landscape' : 'portrait');
        curY = m;
      }

      let cellX = startX;

      for (let c = 0; c < maxCols; c++) {
        const meta = getCellMeta(allRows[r][c]);

        if (meta.isCovered) {
          cellX += colW[c];
          continue;
        }

        let cellW = 0;
        for (let i = 0; i < meta.spanW && (c + i) < maxCols; i++) {
          cellW += colW[c + i];
        }

        if (c + meta.spanW >= maxCols) {
          cellW = (startX + tableW) - cellX;
        }

        let cellH = 0;
        for (let k = 0; k < meta.spanH && (r + k) < allRows.length; k++) {
          cellH += rowHeights[r + k];
        }

        if (isHead) {
          doc.setFillColor(230, 240, 255);
          doc.rect(cellX, curY, cellW, cellH, 'F');
        } else if (r % 2 === 0) {
          doc.setFillColor(248, 248, 248);
          doc.rect(cellX, curY, cellW, cellH, 'F');
        }

        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.2);
        doc.rect(cellX, curY, cellW, cellH, 'S');

        doc.setFontSize(fontSize);
        doc.setFont('helvetica', isHead ? 'bold' : 'normal');
        doc.setTextColor(isHead ? 30 : 50, isHead ? 30 : 50, isHead ? 30 : 50);

        const lines = cellLinesMatrix[r][c] || [];
        const totalTextH = lines.length * lh;
        const verticalOffset = Math.max(0, (cellH - totalTextH) / 2);
        let textY = curY + verticalOffset + lh * 0.75;

        for (const line of lines) {
          doc.text(line, cellX + cellPadX, textY);
          textY += lh;
        }

        cellX += cellW;
        c += (meta.spanW - 1);
      }

      curY += rowH;
    }

    setY(curY + 4);
  },

  // =================================================================
  // _extractBlocks : Parcourt le container HTML du serializer V9
  // =================================================================
  _extractBlocks(container) {
    const blocks = [];

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text.length > 0) blocks.push({ type: 'p', text });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();

      // Ignorer les styles et scripts
      if (['script', 'style', 'noscript', 'link', 'meta'].includes(tag)) return;

      // Métadonnées de grounding (le bloc .clipper-meta)
      if (node.classList && node.classList.contains('clipper-meta')) {
        const title = node.querySelector('.meta-title');
        if (title) blocks.push({ type: 'meta-title', text: title.textContent.trim() });

        const infos = node.querySelectorAll('.meta-date, .meta-author, div:not(.meta-title):not(.meta-date):not(.meta-author)');
        infos.forEach(el => {
          const a = el.querySelector('a');
          if (a && a.href) {
            blocks.push({ type: 'meta-url', text: a.href });
          } else {
            const t = el.textContent.trim();
            if (t && !el.classList.contains('meta-label') && !el.classList.contains('meta-title')) {
              blocks.push({ type: 'meta-info', text: t });
            }
          }
        });
        return;
      }

      // Images (data URIs du serializer)
      if (tag === 'img') {
        const src = node.getAttribute('src') || '';
        if (src.startsWith('data:')) {
          const w = parseInt(node.getAttribute('width'), 10) || node.naturalWidth || 400;
          const h = parseInt(node.getAttribute('height'), 10) || node.naturalHeight || 300;
          blocks.push({ type: 'image', data: src, width: w, height: h });
        }
        return;
      }

      // Éléments à ignorer
      if (['svg', 'video', 'audio', 'canvas', 'iframe', 'input', 'select',
           'textarea', 'button', 'form', 'object', 'embed'].includes(tag)) return;

      // Tables
      if (tag === 'table') {
        const { head, body } = flattenTable(node);
        if (head.length > 0 || body.length > 0) {
          blocks.push({ type: 'table', head, body });
        }
        return;
      }

      // Titres
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        const text = node.textContent.trim();
        if (text) blocks.push({ type: tag, text });
        return;
      }

      // Séparateurs
      if (tag === 'hr') { blocks.push({ type: 'hr' }); return; }

      // Listes
      if (tag === 'li') {
        const hasBlock = node.querySelector('table, div, p, ul, ol, h1, h2, h3, h4, h5, h6');
        if (hasBlock) {
          for (const child of node.childNodes) walk(child);
        } else {
          const text = node.textContent.trim();
          if (text) blocks.push({ type: 'li', text });
        }
        return;
      }

      // Paragraphes (blocs terminaux)
      if (['p', 'blockquote', 'figcaption', 'pre', 'code'].includes(tag)) {
        // Vérifier s'il contient des images
        const imgs = node.querySelectorAll('img');
        if (imgs.length > 0) {
          // Parcourir pour extraire texte + images séparément
          for (const child of node.childNodes) walk(child);
          return;
        }
        const text = node.textContent.trim();
        if (text) blocks.push({ type: 'p', text });
        return;
      }

      // Figure (peut contenir img + figcaption)
      if (tag === 'figure') {
        for (const child of node.childNodes) walk(child);
        return;
      }

      // Conteneurs : descendre
      for (const child of node.childNodes) walk(child);
    };

    // On parcourt le .clipper-reader s'il existe, sinon le container entier
    const reader = container.querySelector('.clipper-reader');
    walk(reader || container);

    // Dédupliquer les blocs texte consécutifs identiques
    const deduped = [];
    for (const b of blocks) {
      if (b.type === 'table' || b.type === 'image' || b.type === 'hr' ||
          b.type === 'meta-title' || b.type === 'meta-url' || b.type === 'meta-info') {
        deduped.push(b);
        continue;
      }
      if (!b.text || b.text.length === 0) continue;
      const last = deduped[deduped.length - 1];
      if (last && last.type === b.type && last.text === b.text) continue;
      deduped.push(b);
    }

    return deduped;
  }
};
