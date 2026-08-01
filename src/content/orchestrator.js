window.__mc4gd_orchestrator = true;
// orchestrator.js — Orchestrateur principal pour MC4GD
// Auteur : MTF Karukera | Licence : MPL-2.0
// Chargé en dernier par le background script. Écoute l'ordre de capture.

(function() {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'CAPTURE_CONTENT') {
      const format = message.format || window.__mc4gd_capture_format || 'pdf';
      
      // On wrap dans une async function pour utiliser await
      (async () => {
        try {
          // 1. Cloner le body pour isoler les manipulations du DOM
          const wrapperClone = document.body.cloneNode(true);
          
          // 3. Génération dans le format demandé
          if (format === 'pdf_clean' || format === 'pdf_article' || format === 'pdf' || format === 'pdf_visual') {
            // MOTEUR PDF PRINCIPAL : _cleanDomFallback + jsPDF + fix anti-débordement
            // Conserve l'image de couverture principale (Hero Image) et la totalité du texte juridique sans découpe sémantique
            const visualContainer = await window.MC4GDSerializer.getVisualContainer(wrapperClone);
            resultData = await window.MC4GDPdfGenerator.generate(visualContainer);
          } else if (format === 'md') {
            const container = await window.MC4GDSerializer.process(wrapperClone);
            resultData = window.MC4GDMdGenerator.generate(container);
          } else {
            throw new Error(`Format non supporté: ${format}`);
          }
          
          // 4. Envoi au background
          browser.runtime.sendMessage({
            action: 'uploadCapturedBlob',
            format: format,
            data: resultData,
            pageTitle: document.title || 'Document_sans_titre'
          });
          
        } catch (error) {
          console.error('[MC4GD] Erreur lors de la capture:', error);
          browser.runtime.sendMessage({
            action: 'uploadCapturedBlob',
            error: error.message || String(error)
          });
        }
      })();
      
      // Retourner true indique qu'on va utiliser sendResponse de manière asynchrone 
      // (bien qu'ici on utilise sendMessage, on garde le canal ouvert par sécurité)
      return true;
    }
  });
})();
