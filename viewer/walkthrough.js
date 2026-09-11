    /* ============================================================
       Walkthrough — reader-paced steps beside the stage.
       Each authored step names semantic nodes and relationships that already
       exist in the canonical SVG. The module owns data-walkthrough-* reading
       state, a looping carrier on every active relationship, the side panel,
       and a Markdown serialization of every step. It never adds topology,
       geometry, labels, or relationships the author did not write.
       ============================================================ */
    Archify.walkthrough = (function () {
      var data = document.getElementById('archify-walkthrough-data');
      var shell = document.querySelector('.container');
      var svg = document.querySelector('.diagram-container svg');
      var panel = document.getElementById('walkthrough');
      var trigger = document.getElementById('btn-walkthrough');
      var triggerLabel = document.getElementById('walkthrough-button-label');
      var menuItem = document.querySelector('#export-menu button[data-action="walkthrough-markdown"]');
      var exportMenu = document.getElementById('export-menu');
      var counter = document.getElementById('walkthrough-counter');
      var clock = document.getElementById('walkthrough-clock');
      var closeButton = document.getElementById('walkthrough-close');
      var titleEl = document.getElementById('walkthrough-title');
      var heading = document.getElementById('walkthrough-heading');
      var body = document.getElementById('walkthrough-body');
      var notes = document.getElementById('walkthrough-notes');
      var stateEl = document.getElementById('walkthrough-state');
      var highlights = document.getElementById('walkthrough-highlights');
      var highlightsBody = document.getElementById('walkthrough-highlights-body');
      var prev = document.getElementById('walkthrough-prev');
      var next = document.getElementById('walkthrough-next');
      var pips = document.getElementById('walkthrough-pips');
      var markdownButton = document.getElementById('walkthrough-markdown');
      var svgButton = document.getElementById('walkthrough-svg');
      var pngButton = document.getElementById('walkthrough-png');
      var status = document.getElementById('walkthrough-status');
      var flowStatus = document.getElementById('walkthrough-flow');
      var SVG_NS = 'http://www.w3.org/2000/svg';
      var MAX_CARRIER_EDGES = 12;
      var CARRIERS_PER_EDGE = 2;
      var FLOW_DURATION_S = 1.6;
      var payload = null;
      var steps = [];
      var activeIndex = -1;
      var open = false;
      var carrierToken = 0;
      var statusTimer = null;
      var pipButtons = [];
      var reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

      try { payload = JSON.parse(data ? data.textContent : 'null'); } catch (_) { payload = null; }
      steps = payload && Array.isArray(payload.steps) ? payload.steps.filter(function (step) {
        return step && typeof step.id === 'string' && typeof step.title === 'string';
      }) : [];
      var flowMode = payload && (payload.flow === 'step' || payload.flow === 'off') ? payload.flow : 'continuous';

      if (!steps.length || !panel || !svg || !shell) {
        if (trigger) trigger.hidden = true;
        if (menuItem) menuItem.hidden = true;
        return { count: 0, active: function () { return null; }, isOpen: function () { return false; } };
      }
      trigger.hidden = false;
      if (menuItem) menuItem.hidden = false;
      panel.setAttribute('data-flow', flowMode);
      if (payload.title) {
        titleEl.textContent = payload.title;
        titleEl.hidden = false;
      }

      function nodes() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
      }
      function edges() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'));
      }
      function nodeMap() {
        var byId = {};
        nodes().forEach(function (node) { byId[node.getAttribute('data-node-id')] = node; });
        return byId;
      }
      function nodeLabel(node, fallback) {
        return (node && node.getAttribute('data-node-label')) || fallback;
      }
      // A reference is an authored relationship id, or from~to naming a direct
      // authored relationship. Both resolve only against what the SVG carries.
      function resolveEdges(step) {
        var list = edges();
        var chosen = [];
        (step.edges || []).forEach(function (reference) {
          var matches;
          if (reference.indexOf('~') !== -1) {
            var parts = reference.split('~');
            matches = list.filter(function (edge) {
              return edge.getAttribute('data-edge-from') === parts[0] && edge.getAttribute('data-edge-to') === parts[1];
            });
          } else {
            matches = list.filter(function (edge) { return edge.getAttribute('data-edge-id') === reference; });
          }
          matches.forEach(function (edge) { if (chosen.indexOf(edge) === -1) chosen.push(edge); });
        });
        return chosen;
      }
      function edgeGeometry(edge) {
        if (/^(path|line|polyline)$/i.test(edge.tagName)) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }
      function edgeLabel(edge, byId) {
        var label = edge.getAttribute('data-edge-label');
        var from = nodeLabel(byId[edge.getAttribute('data-edge-from')], edge.getAttribute('data-edge-from'));
        var to = nodeLabel(byId[edge.getAttribute('data-edge-to')], edge.getAttribute('data-edge-to'));
        return from + ' → ' + to + (label ? ' (' + label + ')' : '');
      }

      function clearStage() {
        svg.removeAttribute('data-walkthrough-active');
        Array.prototype.forEach.call(svg.querySelectorAll('[data-walkthrough-node], [data-walkthrough-edge]'), function (el) {
          el.removeAttribute('data-walkthrough-node');
          el.removeAttribute('data-walkthrough-edge');
        });
      }
      function clearCarriers(options) {
        options = options || {};
        Array.prototype.forEach.call(svg.querySelectorAll('[data-walkthrough-carrier-overlay]'), function (el) { el.remove(); });
        if (carrierToken && options.release !== false && Archify.motionGovernor) {
          var token = carrierToken;
          carrierToken = 0;
          Archify.motionGovernor.release(token);
        } else if (options.release === false) {
          carrierToken = 0;
        }
      }
      function flowAllowed() {
        if (flowMode === 'off') return false;
        if (document.hidden) return false;
        if (reducedMotionQuery && reducedMotionQuery.matches) return false;
        if (document.documentElement.getAttribute('data-embed') === 'true') return false;
        if (window.matchMedia && window.matchMedia('print').matches) return false;
        // Without ambient trace the Governor is a stub that always reports
        // paused; only a capable Governor can carry a reader's Still choice.
        if (Archify.motionGovernor && Archify.motionGovernor.capable) return !Archify.motionGovernor.isPaused();
        return true;
      }
      function renderFlowStatus(running) {
        if (flowMode === 'off') flowStatus.textContent = viewerText('viewer.walkthrough.flowOff');
        else flowStatus.textContent = viewerText(running ? 'viewer.walkthrough.flowLive' : 'viewer.walkthrough.flowStill');
      }
      // Continuous traffic: the Story carrier, made to loop. Each active
      // relationship receives staggered tokens riding its own authored path.
      function renderCarriers(activeEdges) {
        clearCarriers();
        if (!activeEdges.length || !flowAllowed() || !Archify.flowTokens || typeof Archify.flowTokens.create !== 'function') {
          renderFlowStatus(false);
          return false;
        }
        var overlay = document.createElementNS(SVG_NS, 'g');
        overlay.setAttribute('class', 'walkthrough-carrier-overlay');
        overlay.setAttribute('data-walkthrough-carrier-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        var created = 0;
        activeEdges.slice(0, MAX_CARRIER_EDGES).forEach(function (edge) {
          var shapes = edgeGeometry(edge);
          if (!shapes.length) return;
          for (var i = 0; i < CARRIERS_PER_EDGE; i += 1) {
            var token = Archify.flowTokens.create(edge, shapes[0], {
              className: 'walkthrough-flow-token',
              duration: FLOW_DURATION_S + 's'
            });
            if (!token) continue;
            token.setAttribute('data-walkthrough-carrier-token', '');
            if (flowMode === 'step') token.setAttribute('data-walkthrough-once', '');
            var motion = token.querySelector('animateMotion');
            if (motion) {
              motion.setAttribute('begin', (i * FLOW_DURATION_S / CARRIERS_PER_EDGE) + 's');
              if (flowMode === 'continuous') {
                motion.setAttribute('repeatCount', 'indefinite');
                motion.removeAttribute('fill');
              }
            }
            token.style.setProperty('animation-delay', (i * FLOW_DURATION_S / CARRIERS_PER_EDGE) + 's');
            var wrapper = document.createElementNS(SVG_NS, 'g');
            if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
            wrapper.appendChild(token);
            overlay.appendChild(wrapper);
            created += 1;
          }
        });
        if (!created) { renderFlowStatus(false); return false; }
        var firstNode = svg.querySelector('[data-node-id]');
        while (firstNode && firstNode.parentNode !== svg) firstNode = firstNode.parentNode;
        if (firstNode) svg.insertBefore(overlay, firstNode);
        else svg.appendChild(overlay);
        if (Archify.motionGovernor && Archify.motionGovernor.capable) {
          carrierToken = Archify.motionGovernor.claim('walkthrough', function () {
            clearCarriers({ release: false });
            renderFlowStatus(false);
          });
        }
        renderFlowStatus(true);
        return true;
      }

      function yieldOtherOwners() {
        if (Archify.guidedViews && Archify.guidedViews.count) {
          if (typeof Archify.guidedViews.isPlaying === 'function' && Archify.guidedViews.isPlaying() && typeof Archify.guidedViews.pause === 'function') {
            Archify.guidedViews.pause();
          }
          if (typeof Archify.guidedViews.active === 'function' && Archify.guidedViews.active() && typeof Archify.guidedViews.showAll === 'function') {
            Archify.guidedViews.showAll({ updateUrl: false });
          }
        }
        if (Archify.routeProbe && typeof Archify.routeProbe.active === 'function' && Archify.routeProbe.active() && typeof Archify.routeProbe.clear === 'function') {
          Archify.routeProbe.clear({ updateUrl: false, restoreFocus: false });
        }
        if (Archify.semanticLens && typeof Archify.semanticLens.active === 'function' && Archify.semanticLens.active() && typeof Archify.semanticLens.clear === 'function') {
          Archify.semanticLens.clear({ updateUrl: false, preserveView: true, closePanel: true });
        }
        if (Archify.focus && typeof Archify.focus.active === 'function' && Archify.focus.active() && typeof Archify.focus.clear === 'function') {
          Archify.focus.clear({ updateUrl: false, preserveView: true });
        }
      }

      function paragraphs(text) {
        return String(text || '').split(/\n\s*\n/).map(function (part) { return part.trim(); }).filter(Boolean);
      }
      // Inline emphasis only: **strong** and `code`. Everything is inserted as
      // text nodes, so authored copy can never become markup.
      function appendInline(target, text) {
        var re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
        var last = 0;
        var match;
        while ((match = re.exec(text)) !== null) {
          if (match.index > last) target.appendChild(document.createTextNode(text.slice(last, match.index)));
          var token = match[0];
          var el = document.createElement(token.charAt(0) === '`' ? 'code' : 'strong');
          el.textContent = token.slice(token.charAt(0) === '`' ? 1 : 2, token.charAt(0) === '`' ? -1 : -2);
          target.appendChild(el);
          last = match.index + token.length;
        }
        if (last < text.length) target.appendChild(document.createTextNode(text.slice(last)));
      }
      function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }

      function renderPanel(step, index, activeNodes, activeEdges, byId) {
        counter.textContent = viewerText('viewer.walkthrough.step', { index: index + 1, count: steps.length });
        clock.textContent = step.clock || '';
        clock.hidden = !step.clock;
        heading.textContent = step.title;
        clearChildren(body);
        paragraphs(step.body).forEach(function (text) {
          var p = document.createElement('p');
          appendInline(p, text);
          body.appendChild(p);
        });
        clearChildren(notes);
        (step.notes || []).forEach(function (note) {
          if (!note || !note.title || !note.body) return;
          var section = document.createElement('section');
          section.className = 'walkthrough-note';
          var strong = document.createElement('strong');
          strong.textContent = note.title;
          var p = document.createElement('p');
          appendInline(p, note.body);
          section.appendChild(strong);
          section.appendChild(p);
          notes.appendChild(section);
        });
        clearChildren(stateEl);
        var chips = step.state || [];
        chips.forEach(function (chip) {
          var span = document.createElement('span');
          span.className = 'walkthrough-chip';
          span.setAttribute('role', 'listitem');
          span.textContent = chip;
          stateEl.appendChild(span);
        });
        stateEl.hidden = !chips.length;
        clearChildren(highlightsBody);
        if (activeNodes.length || activeEdges.length) {
          var list = document.createElement('ul');
          if (activeNodes.length) {
            var li = document.createElement('li');
            li.textContent = viewerText('viewer.walkthrough.nodes') + ': ' + activeNodes.map(function (node) {
              return nodeLabel(node, node.getAttribute('data-node-id'));
            }).join(', ');
            list.appendChild(li);
          }
          if (activeEdges.length) {
            var li2 = document.createElement('li');
            li2.textContent = viewerText('viewer.walkthrough.relationships') + ': ' + activeEdges.map(function (edge) {
              return edgeLabel(edge, byId);
            }).join('; ');
            list.appendChild(li2);
          }
          highlightsBody.appendChild(list);
          highlights.hidden = false;
        } else {
          highlights.hidden = true;
        }
        pipButtons.forEach(function (button, pipIndex) {
          if (pipIndex === index) button.setAttribute('aria-current', 'step');
          else button.removeAttribute('aria-current');
          button.setAttribute('data-state', pipIndex < index ? 'done' : pipIndex === index ? 'current' : 'pending');
        });
        prev.disabled = index === 0;
        next.disabled = index === steps.length - 1;
        panel.setAttribute('data-step', step.id);
        panel.setAttribute('data-step-index', String(index));
      }

      function updateUrl(step) {
        try {
          history.replaceState(null, '', location.pathname + location.search + (step ? '#walk=' + encodeURIComponent(step.id) : ''));
        } catch (_) {}
      }

      function activate(index, options) {
        options = options || {};
        if (index < 0 || index >= steps.length) return false;
        var step = steps[index];
        activeIndex = index;
        yieldOtherOwners();
        clearStage();
        var byId = nodeMap();
        var activeNodes = [];
        (step.focus || []).forEach(function (id) {
          var node = byId[id];
          if (node && activeNodes.indexOf(node) === -1) {
            node.setAttribute('data-walkthrough-node', 'on');
            activeNodes.push(node);
          }
        });
        (step.dim || []).forEach(function (id) {
          var node = byId[id];
          if (node && !node.hasAttribute('data-walkthrough-node')) node.setAttribute('data-walkthrough-node', 'dim');
        });
        var activeEdges = resolveEdges(step);
        activeEdges.forEach(function (edge) { edge.setAttribute('data-walkthrough-edge', 'on'); });
        svg.setAttribute('data-walkthrough-active', step.id);
        renderCarriers(activeEdges);
        renderPanel(step, index, activeNodes, activeEdges, byId);
        if (options.updateUrl !== false) updateUrl(step);
        return true;
      }

      function refreshFlow() {
        if (!open || activeIndex < 0) return false;
        return renderCarriers(resolveEdges(steps[activeIndex]));
      }

      function setOpen(nextOpen, options) {
        options = options || {};
        if (nextOpen === open && options.force !== true) return open;
        open = nextOpen;
        if (open) {
          shell.setAttribute('data-walkthrough', 'open');
          panel.hidden = false;
          trigger.setAttribute('aria-pressed', 'true');
          trigger.setAttribute('aria-label', viewerText('viewer.walkthrough.close'));
          activate(activeIndex >= 0 ? activeIndex : 0, options);
          if (options.focusPanel !== false) heading.setAttribute('tabindex', '-1'), heading.focus({ preventScroll: true });
        } else {
          shell.removeAttribute('data-walkthrough');
          panel.hidden = true;
          trigger.setAttribute('aria-pressed', 'false');
          trigger.setAttribute('aria-label', viewerText('viewer.walkthrough.open'));
          clearCarriers();
          clearStage();
          renderFlowStatus(false);
          if (options.updateUrl !== false) updateUrl(null);
          if (options.restoreFocus === true) trigger.focus();
        }
        // Reader and chrome layout measure on resize; a panel appearing beside
        // the stage changes the available width the same way a window would.
        try { window.dispatchEvent(new Event('resize')); } catch (_) {}
        return open;
      }

      function showStatus(message) {
        status.textContent = message;
        clearTimeout(statusTimer);
        statusTimer = setTimeout(function () { status.textContent = ''; }, 1800);
      }
      function diagramTitle() {
        var h1 = document.querySelector('.header h1');
        return (h1 && h1.textContent.trim()) || document.title || 'Diagram';
      }
      function fileBase() {
        return diagramTitle().replace(/[^a-z0-9_\-]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'diagram';
      }
      // Markdown is a truthful transcript of the authored steps plus the labels
      // of the nodes and relationships each step highlights. It carries no
      // inferred topology and no binary payload.
      function markdown() {
        var byId = nodeMap();
        var lines = [];
        lines.push('# ' + diagramTitle() + ' — ' + (payload.title || viewerText('viewer.walkthrough.markdown.title')));
        lines.push('');
        lines.push('_' + viewerText('viewer.walkthrough.markdown.generated') + '_');
        lines.push('');
        lines.push('## ' + viewerText('viewer.walkthrough.markdown.diagram'));
        lines.push('');
        lines.push(viewerText('viewer.walkthrough.markdown.exportNote'));
        lines.push('');
        steps.forEach(function (step, index) {
          lines.push('## ' + viewerText('viewer.walkthrough.markdown.step', { index: index + 1 }) + ' — ' + step.title);
          lines.push('');
          if (step.clock) { lines.push('**' + step.clock + '**'); lines.push(''); }
          paragraphs(step.body).forEach(function (text) { lines.push(text); lines.push(''); });
          if (step.state && step.state.length) {
            lines.push('**' + viewerText('viewer.walkthrough.state') + ':** ' + step.state.join(' · '));
            lines.push('');
          }
          var activeNodes = (step.focus || []).map(function (id) { return nodeLabel(byId[id], id); });
          var activeEdges = resolveEdges(step).map(function (edge) { return edgeLabel(edge, byId); });
          if (activeNodes.length || activeEdges.length) {
            var parts = [];
            if (activeNodes.length) parts.push(viewerText('viewer.walkthrough.nodes') + ': ' + activeNodes.join(', '));
            if (activeEdges.length) parts.push(viewerText('viewer.walkthrough.relationships') + ': ' + activeEdges.join('; '));
            lines.push('**' + viewerText('viewer.walkthrough.highlights') + ':** ' + parts.join(' — '));
            lines.push('');
          }
          (step.notes || []).forEach(function (note) {
            if (!note || !note.title || !note.body) return;
            lines.push('### ' + note.title);
            lines.push('');
            lines.push(note.body);
            lines.push('');
          });
        });
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
      }
      function downloadMarkdown() {
        var text = markdown();
        var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = fileBase() + '-walkthrough.md';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        document.documentElement.setAttribute('data-last-walkthrough-export-bytes', String(blob.size));
        showStatus(viewerText('viewer.walkthrough.markdownDownloaded'));
        return blob;
      }

      // Pips are built once from authored order; state is written per step.
      steps.forEach(function (step, index) {
        var li = document.createElement('li');
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'walkthrough-pip';
        button.textContent = String(index + 1);
        button.setAttribute('aria-label', viewerText('viewer.walkthrough.goToStep', { index: index + 1, title: step.title }));
        button.setAttribute('data-step-id', step.id);
        button.addEventListener('click', function () { activate(index); });
        li.appendChild(button);
        pips.appendChild(li);
        pipButtons.push(button);
      });

      trigger.addEventListener('click', function () { setOpen(!open); });
      closeButton.addEventListener('click', function () { setOpen(false, { restoreFocus: true }); });
      prev.addEventListener('click', function () { activate(activeIndex - 1); });
      next.addEventListener('click', function () { activate(activeIndex + 1); });
      markdownButton.addEventListener('click', function () { downloadMarkdown(); });
      svgButton.addEventListener('click', function () {
        if (Archify.exportMenu && typeof Archify.exportMenu.run === 'function') Archify.exportMenu.run('svg');
      });
      pngButton.addEventListener('click', function () {
        if (Archify.exportMenu && typeof Archify.exportMenu.run === 'function') Archify.exportMenu.run('png');
      });
      if (exportMenu) {
        exportMenu.addEventListener('click', function (e) {
          var item = e.target.closest('button[data-action="walkthrough-markdown"]');
          if (!item || item.disabled) return;
          if (Archify.exportMenu && typeof Archify.exportMenu.close === 'function') Archify.exportMenu.close(true);
          downloadMarkdown();
        });
      }
      panel.addEventListener('keydown', function (e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); activate(activeIndex + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); activate(activeIndex - 1); }
        else if (e.key === 'Home') { e.preventDefault(); activate(0); }
        else if (e.key === 'End') { e.preventDefault(); activate(steps.length - 1); }
      });
      document.addEventListener('visibilitychange', function () { refreshFlow(); });
      if (reducedMotionQuery && typeof reducedMotionQuery.addEventListener === 'function') {
        reducedMotionQuery.addEventListener('change', function () { refreshFlow(); });
      }
      if (window.MutationObserver) {
        new MutationObserver(function (records) {
          if (!open) return;
          var relevant = records.some(function (record) {
            return record.attributeName === 'data-motion' || record.attributeName === 'data-embed';
          });
          if (relevant) refreshFlow();
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-embed'] });
      }

      function stepIndexFromHash() {
        var match = /(?:^|[#&])walk=([^&]+)/.exec(location.hash || '');
        if (!match) return -1;
        var id = decodeURIComponent(match[1]);
        return steps.findIndex(function (step) { return step.id === id; });
      }
      function syncFromHash() {
        var index = stepIndexFromHash();
        if (index < 0) return false;
        activeIndex = index;
        setOpen(true, { updateUrl: false, focusPanel: false, force: true });
        return true;
      }
      window.addEventListener('hashchange', syncFromHash);
      // A #walk= hash opens and activates a step before this line; only a
      // closed panel starts from the still label.
      if (!syncFromHash()) renderFlowStatus(false);

      return {
        count: steps.length,
        isOpen: function () { return open; },
        open: function (options) { return setOpen(true, options); },
        close: function (options) { return setOpen(false, options); },
        toggle: function (options) { return setOpen(!open, options); },
        go: function (index, options) { if (!open) setOpen(true, { updateUrl: false, focusPanel: false }); return activate(index, options); },
        next: function () { return open && activate(activeIndex + 1); },
        prev: function () { return open && activate(activeIndex - 1); },
        active: function () { return open && activeIndex >= 0 ? steps[activeIndex].id : null; },
        markdown: markdown,
        downloadMarkdown: downloadMarkdown,
        refreshFlow: refreshFlow
      };
    })();
