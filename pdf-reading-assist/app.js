(() => {
  "use strict";

  const pdfjs = window.pdfjsLib;
  if (pdfjs) {
    pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
  }

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const elements = {
    fileInput: $("#file-input"), emptyState: $("#empty-state"), dropZone: $("#drop-zone"),
    reader: $("#reader"), viewer: $("#viewer"), pageScroll: $("#page-scroll"), pages: $("#pages"), loading: $("#loading"),
    fileName: $("#file-name"), currentPage: $("#current-page"), pageCount: $("#page-count"),
    lineStatus: $("#line-status"),
    prevPage: $("#prev-page"), nextPage: $("#next-page"), zoomOut: $("#zoom-out"),
    zoomIn: $("#zoom-in"), zoomValue: $("#zoom-value"), guide: $("#guide"),
    guideToggle: $("#guide-toggle"), lineUp: $("#line-up"), lineDown: $("#line-down"),
    appShell: $(".app-shell"), headerHide: $("#header-hide"), headerShow: $("#header-show"),
    settingsOpen: $("#settings-open"), settingsClose: $("#settings-close"),
    settingsPanel: $("#settings-panel"), backdrop: $("#settings-backdrop"),
    height: $("#guide-height"), heightValue: $("#guide-height-value"),
    opacity: $("#guide-opacity"), opacityValue: $("#guide-opacity-value"),
    lineSnap: $("#line-snap"), focusMode: $("#focus-mode"), savePosition: $("#save-position"), toast: $("#toast")
  };

  const defaults = { guideHeight: 32, opacity: 28, color: "#e9a23b", step: 32, lineSnap: true, focus: true, save: true, guideOn: true, headerVisible: true };
  const savedSettings = safeParse(localStorage.getItem("readingAssist.settings"));
  const state = {
    pdf: null, fileKey: null, scale: 1, renderToken: 0, guideY: 210,
    currentPage: 1, lines: [], pageObserver: null, renderTasks: new Set(), layoutBusy: false,
    wheelAccumulator: 0, wheelLockUntil: 0, wheelResetTimer: null,
    settings: { ...defaults, ...(savedSettings || {}) }, saveTimer: null
  };

  function safeParse(value) {
    try { return JSON.parse(value); } catch { return null; }
  }

  function toRgb(hex) {
    const value = hex.replace("#", "");
    return `${parseInt(value.slice(0,2), 16)}, ${parseInt(value.slice(2,4), 16)}, ${parseInt(value.slice(4,6), 16)}`;
  }

  function clampGuideY(y) {
    const max = Math.max(0, elements.viewer.clientHeight - state.settings.guideHeight - 2);
    return Math.max(0, Math.min(y, max));
  }

  function applySettings() {
    const s = state.settings;
    document.documentElement.style.setProperty("--guide-height", `${s.guideHeight}px`);
    document.documentElement.style.setProperty("--guide-opacity", s.opacity / 100);
    document.documentElement.style.setProperty("--guide-rgb", toRgb(s.color));
    elements.height.value = s.guideHeight;
    elements.heightValue.value = `${s.guideHeight}px`;
    elements.opacity.value = s.opacity;
    elements.opacityValue.value = `${s.opacity}%`;
    elements.lineSnap.checked = s.lineSnap;
    elements.focusMode.checked = s.focus;
    elements.savePosition.checked = s.save;
    elements.viewer.classList.toggle("focus-off", !s.focus);
    elements.viewer.classList.toggle("guide-off", !s.guideOn);
    elements.appShell.classList.toggle("header-hidden", !s.headerVisible);
    elements.headerShow.hidden = s.headerVisible;
    elements.guideToggle.setAttribute("aria-pressed", String(s.guideOn));
    $$(".color-chip").forEach((button) => {
      const active = button.dataset.color === s.color;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $$("[data-step]").forEach((button) => button.classList.toggle("active", Number(button.dataset.step) === s.step));
    setGuideY(state.guideY, false);
  }

  function saveSettings() {
    localStorage.setItem("readingAssist.settings", JSON.stringify(state.settings));
  }

  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
  }

  function setGuideY(y, persist = true) {
    state.guideY = clampGuideY(y);
    elements.viewer.style.setProperty("--guide-y", `${state.guideY}px`);
    const max = Math.max(1, elements.viewer.clientHeight - state.settings.guideHeight);
    elements.guide.setAttribute("aria-valuenow", String(Math.round((state.guideY / max) * 100)));
    if (persist) schedulePositionSave();
  }

  function moveGuide(delta) {
    if (state.settings.lineSnap && state.lines.length) {
      moveToAdjacentLine(delta > 0 ? 1 : -1);
      return;
    }
    setGuideY(state.guideY + delta);
  }

  function lineCenter(line) {
    return line.top + line.height / 2;
  }

  function nearestLineIndex(contentY) {
    let nearest = 0;
    let distance = Infinity;
    state.lines.forEach((line, index) => {
      const nextDistance = Math.abs(lineCenter(line) - contentY);
      if (nextDistance < distance) { nearest = index; distance = nextDistance; }
    });
    return nearest;
  }

  function alignGuideToLine(line, preferredScreenY) {
    const guideCenterOffset = state.settings.guideHeight / 2;
    const screenCenter = lineCenter(line) - elements.pageScroll.scrollTop;
    let nextY = screenCenter - guideCenterOffset;
    const edge = 18;
    const maxY = elements.viewer.clientHeight - state.settings.guideHeight - edge;

    if (nextY < edge || nextY > maxY) {
      nextY = preferredScreenY ?? elements.viewer.clientHeight * .34;
      elements.pageScroll.scrollTo({
        top: Math.max(0, lineCenter(line) - nextY - guideCenterOffset),
        behavior: "smooth"
      });
    }
    setGuideY(nextY);
    state.currentPage = line.page;
    elements.currentPage.textContent = line.page;
    elements.prevPage.disabled = line.page <= 1;
    elements.nextPage.disabled = line.page >= state.pdf.numPages;
  }

  function moveToAdjacentLine(direction) {
    const currentContentY = elements.pageScroll.scrollTop + state.guideY + state.settings.guideHeight / 2;
    const currentIndex = nearestLineIndex(currentContentY);
    const targetIndex = Math.max(0, Math.min(state.lines.length - 1, currentIndex + direction));
    alignGuideToLine(state.lines[targetIndex]);
  }

  function handleSnapWheel(event) {
    if (!state.settings.lineSnap || !state.lines.length || event.ctrlKey || event.altKey) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();

    const now = performance.now();
    if (now < state.wheelLockUntil) return;
    state.wheelAccumulator += event.deltaY;
    clearTimeout(state.wheelResetTimer);
    state.wheelResetTimer = setTimeout(() => { state.wheelAccumulator = 0; }, 180);

    const threshold = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 24 : 1;
    if (Math.abs(state.wheelAccumulator) < threshold) return;
    moveToAdjacentLine(state.wheelAccumulator > 0 ? 1 : -1);
    state.wheelAccumulator = 0;
    state.wheelLockUntil = now + 110;
  }

  function extractLines(textContent, viewport, pageNumber, wrapper) {
    const candidates = [];
    textContent.items.forEach((item) => {
      if (!item.str?.trim() || !item.transform) return;
      const transform = pdfjs.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.max(1, Math.hypot(transform[2], transform[3]));
      const isMostlyHorizontal = Math.abs(transform[0]) >= Math.abs(transform[1]);
      if (!isMostlyHorizontal) return;
      candidates.push({
        baseline: transform[5],
        top: transform[5] - fontHeight,
        height: fontHeight,
        left: transform[4],
        text: item.str.trim()
      });
    });

    candidates.sort((a, b) => a.baseline - b.baseline || a.left - b.left);
    const grouped = [];
    candidates.forEach((item) => {
      let line = grouped.find((candidate) => Math.abs(candidate.baseline - item.baseline) <= Math.max(3, item.height * .24));
      if (!line) {
        line = { baseline: item.baseline, top: item.top, height: item.height, items: [] };
        grouped.push(line);
      }
      line.items.push(item);
      line.top = Math.min(line.top, item.top);
      line.height = Math.max(line.height, item.height);
    });

    return grouped
      .filter((line) => line.items.reduce((sum, item) => sum + item.text.length, 0) >= 2)
      .map((line) => ({
        page: pageNumber,
        top: wrapper.offsetTop + line.top,
        height: Math.max(10, line.height),
        text: line.items.sort((a, b) => a.left - b.left).map((item) => item.text).join(" ")
      }));
  }

  function updateLineStatus() {
    elements.lineStatus.hidden = false;
    elements.lineStatus.classList.toggle("no-lines", state.lines.length === 0);
    elements.lineStatus.textContent = state.lines.length ? `${state.lines.length}行検出` : "行検出なし";
  }

  function positionKey() {
    return state.fileKey ? `readingAssist.position.${state.fileKey}` : null;
  }

  function schedulePositionSave() {
    if (!state.settings.save || !state.fileKey) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      localStorage.setItem(positionKey(), JSON.stringify({ scrollTop: elements.pageScroll.scrollTop, guideY: state.guideY, scale: state.scale }));
    }, 180);
  }

  function getSavedPosition() {
    return state.settings.save ? safeParse(localStorage.getItem(positionKey())) : null;
  }

  async function openPdf(file) {
    if (!file || (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
      toast("PDFファイルを選択してください");
      return;
    }
    if (!pdfjs) {
      toast("PDF表示ライブラリを読み込めませんでした。通信環境を確認してください");
      return;
    }

    elements.loading.hidden = false;
    elements.emptyState.hidden = true;
    elements.reader.hidden = false;
    elements.fileName.textContent = file.name;
    state.fileKey = encodeURIComponent(`${file.name}|${file.size}|${file.lastModified}`);
    try {
      stopRenderPipeline();
      state.renderToken += 1;
      if (state.pdf) {
        await state.pdf.destroy();
        state.pdf = null;
      }
      const buffer = await file.arrayBuffer();
      state.pdf = await pdfjs.getDocument({ data: buffer }).promise;
      elements.pageCount.textContent = state.pdf.numPages;
      const saved = getSavedPosition();
      if (saved?.scale) {
        state.scale = Math.max(.6, Math.min(2.2, saved.scale));
      } else {
        const firstPage = await state.pdf.getPage(1);
        const naturalWidth = firstPage.getViewport({ scale: 1 }).width;
        const fitWidth = Math.max(280, elements.viewer.clientWidth - 40);
        state.scale = Math.min(1, Math.max(.6, fitWidth / naturalWidth));
      }
      await renderAllPages();
      if (saved) {
        elements.pageScroll.scrollTop = saved.scrollTop || 0;
        setGuideY(saved.guideY ?? state.guideY, false);
        toast("前回の読書位置を復元しました");
      } else {
        setGuideY(elements.viewer.clientHeight * .34, false);
      }
      if (state.settings.lineSnap && !state.lines.length) {
        toast("文字行を検出できないPDFです。手動ガイドで操作できます");
      }
      updateCurrentPage();
    } catch (error) {
      console.error(error);
      elements.reader.hidden = true;
      elements.emptyState.hidden = false;
      toast("PDFを開けませんでした。ファイルを確認してください");
    } finally {
      elements.loading.hidden = true;
      elements.fileInput.value = "";
    }
  }

  function stopRenderPipeline() {
    state.pageObserver?.disconnect();
    state.pageObserver = null;
    state.renderTasks.forEach((task) => task.cancel());
    state.renderTasks.clear();
  }

  function releasePageCanvas(wrapper) {
    if (wrapper.dataset.rendering === "true") return;
    wrapper.querySelector("canvas")?.remove();
    wrapper.dataset.rendered = "false";
  }

  async function renderPageCanvas(wrapper, token) {
    if (wrapper.dataset.rendered === "true" || wrapper.dataset.rendering === "true") return;
    wrapper.dataset.rendering = "true";
    const pageNumber = Number(wrapper.dataset.page);
    let task;
    try {
      const page = await state.pdf.getPage(pageNumber);
      if (token !== state.renderToken || wrapper.dataset.near !== "true") return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: state.scale * pixelRatio });
      const cssViewport = page.getViewport({ scale: state.scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssViewport.width}px`;
      canvas.style.height = `${cssViewport.height}px`;
      canvas.setAttribute("aria-hidden", "true");
      wrapper.prepend(canvas);
      task = page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport });
      state.renderTasks.add(task);
      await task.promise;
      if (token !== state.renderToken || wrapper.dataset.near !== "true") {
        canvas.remove();
        return;
      }
      wrapper.dataset.rendered = "true";
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") console.error(error);
      wrapper.querySelector("canvas")?.remove();
    } finally {
      if (task) state.renderTasks.delete(task);
      wrapper.dataset.rendering = "false";
    }
  }

  function observePage(wrapper, token) {
    state.pageObserver.observe(wrapper);
    wrapper.dataset.rendered = "false";
    wrapper.dataset.rendering = "false";
    wrapper.dataset.near = "false";
  }

  async function renderAllPages() {
    if (!state.pdf) return;
    stopRenderPipeline();
    const token = ++state.renderToken;
    elements.loading.hidden = false;
    elements.pages.replaceChildren();
    state.lines = [];
    elements.zoomValue.textContent = `${Math.round(state.scale * 100)}%`;
    elements.zoomOut.disabled = true;
    elements.zoomIn.disabled = true;

    state.pageObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const wrapper = entry.target;
        wrapper.dataset.near = String(entry.isIntersecting);
        if (entry.isIntersecting) renderPageCanvas(wrapper, token);
        else releasePageCanvas(wrapper);
      });
    }, { root: elements.pageScroll, rootMargin: "100% 0px", threshold: 0.01 });

    for (let pageNumber = 1; pageNumber <= state.pdf.numPages; pageNumber += 1) {
      if (token !== state.renderToken) return;
      const page = await state.pdf.getPage(pageNumber);
      const cssViewport = page.getViewport({ scale: state.scale });
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page";
      wrapper.dataset.page = pageNumber;
      wrapper.style.width = `${cssViewport.width}px`;
      wrapper.style.height = `${cssViewport.height}px`;
      const tag = document.createElement("span");
      tag.className = "page-number-tag";
      tag.textContent = `${pageNumber}`;
      wrapper.append(tag);
      elements.pages.append(wrapper);
      observePage(wrapper, token);
      const textContent = await page.getTextContent();
      state.lines.push(...extractLines(textContent, cssViewport, pageNumber, wrapper));
    }
    if (token !== state.renderToken) return;
    state.lines.sort((a, b) => a.top - b.top);
    updateLineStatus();
    elements.loading.hidden = true;
    elements.zoomOut.disabled = state.scale <= .6;
    elements.zoomIn.disabled = state.scale >= 2.2;
  }

  function updateCurrentPage() {
    const pages = $$(".pdf-page");
    if (!pages.length) return;
    const target = elements.viewer.getBoundingClientRect().top + state.guideY + state.settings.guideHeight / 2;
    let nearest = pages[0];
    let distance = Infinity;
    pages.forEach((page) => {
      const rect = page.getBoundingClientRect();
      const d = target < rect.top ? rect.top - target : target > rect.bottom ? target - rect.bottom : 0;
      if (d < distance) { nearest = page; distance = d; }
    });
    state.currentPage = Number(nearest.dataset.page);
    elements.currentPage.textContent = state.currentPage;
    elements.prevPage.disabled = state.currentPage <= 1;
    elements.nextPage.disabled = state.currentPage >= state.pdf.numPages;
  }

  function goToPage(pageNumber) {
    const page = $(`.pdf-page[data-page="${pageNumber}"]`);
    if (page) {
      elements.pageScroll.scrollTo({ top: page.offsetTop - 20, behavior: "smooth" });
    }
  }

  async function changeZoom(delta) {
    if (!state.pdf || state.layoutBusy) return;
    state.layoutBusy = true;
    const oldHeight = elements.pageScroll.scrollHeight;
    const ratio = oldHeight ? elements.pageScroll.scrollTop / oldHeight : 0;
    state.scale = Math.round(Math.max(.6, Math.min(2.2, state.scale + delta)) * 10) / 10;
    try {
      await renderAllPages();
      elements.pageScroll.scrollTop = ratio * elements.pageScroll.scrollHeight;
      updateCurrentPage();
      schedulePositionSave();
    } finally {
      state.layoutBusy = false;
      elements.zoomOut.disabled = state.scale <= .6;
      elements.zoomIn.disabled = state.scale >= 2.2;
    }
  }

  function openSettings() {
    elements.backdrop.hidden = false;
    elements.settingsPanel.classList.add("open");
    elements.settingsPanel.setAttribute("aria-hidden", "false");
    elements.settingsClose.focus();
  }

  function closeSettings() {
    elements.settingsPanel.classList.remove("open");
    elements.settingsPanel.setAttribute("aria-hidden", "true");
    setTimeout(() => { elements.backdrop.hidden = true; }, 240);
    elements.settingsOpen.focus();
  }

  function setHeaderVisible(visible) {
    state.settings.headerVisible = visible;
    applySettings();
    saveSettings();
    requestAnimationFrame(() => setGuideY(state.guideY, false));
    if (visible) elements.headerHide.focus();
    else elements.headerShow.focus();
  }

  elements.fileInput.addEventListener("change", () => openPdf(elements.fileInput.files[0]));
  elements.dropZone.addEventListener("click", () => elements.fileInput.click());
  elements.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); elements.fileInput.click(); }
  });
  ["dragenter", "dragover"].forEach((type) => elements.dropZone.addEventListener(type, (event) => {
    event.preventDefault(); elements.dropZone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((type) => elements.dropZone.addEventListener(type, (event) => {
    event.preventDefault(); elements.dropZone.classList.remove("dragging");
  }));
  elements.dropZone.addEventListener("drop", (event) => openPdf(event.dataTransfer.files[0]));
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    if (!elements.reader.hidden) openPdf(event.dataTransfer.files[0]);
  });

  elements.guideToggle.addEventListener("click", () => {
    state.settings.guideOn = !state.settings.guideOn; applySettings(); saveSettings();
  });
  elements.lineUp.addEventListener("click", () => moveGuide(-state.settings.step));
  elements.lineDown.addEventListener("click", () => moveGuide(state.settings.step));
  elements.prevPage.addEventListener("click", () => goToPage(state.currentPage - 1));
  elements.nextPage.addEventListener("click", () => goToPage(state.currentPage + 1));
  elements.zoomOut.addEventListener("click", () => changeZoom(-.1));
  elements.zoomIn.addEventListener("click", () => changeZoom(.1));
  elements.settingsOpen.addEventListener("click", openSettings);
  elements.settingsClose.addEventListener("click", closeSettings);
  elements.backdrop.addEventListener("click", closeSettings);
  elements.headerHide.addEventListener("click", () => setHeaderVisible(false));
  elements.headerShow.addEventListener("click", () => setHeaderVisible(true));

  elements.viewer.addEventListener("click", (event) => {
    if (event.target.closest(".reading-guide")) return;
    const rect = elements.viewer.getBoundingClientRect();
    const clickedY = event.clientY - rect.top;
    if (state.settings.lineSnap && state.lines.length) {
      const contentY = elements.pageScroll.scrollTop + clickedY;
      const line = state.lines[nearestLineIndex(contentY)];
      alignGuideToLine(line, clickedY - state.settings.guideHeight / 2);
    } else {
      setGuideY(clickedY - state.settings.guideHeight / 2);
    }
  });
  elements.pageScroll.addEventListener("scroll", () => {
    updateCurrentPage(); schedulePositionSave();
  }, { passive: true });
  elements.viewer.addEventListener("wheel", handleSnapWheel, { passive: false });

  let dragOffset = 0;
  elements.guide.addEventListener("pointerdown", (event) => {
    dragOffset = event.clientY - elements.guide.getBoundingClientRect().top;
    elements.guide.setPointerCapture(event.pointerId);
  });
  elements.guide.addEventListener("pointermove", (event) => {
    if (!elements.guide.hasPointerCapture(event.pointerId)) return;
    const rect = elements.viewer.getBoundingClientRect();
    setGuideY(event.clientY - rect.top - dragOffset);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.settingsPanel.classList.contains("open")) { closeSettings(); return; }
    if (elements.reader.hidden || /INPUT|BUTTON/.test(document.activeElement.tagName)) return;
    if (event.key === "ArrowUp") { event.preventDefault(); moveGuide(-state.settings.step); }
    if (event.key === "ArrowDown") { event.preventDefault(); moveGuide(state.settings.step); }
  });
  elements.guide.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") { event.preventDefault(); moveGuide(-state.settings.step); }
    if (event.key === "ArrowDown") { event.preventDefault(); moveGuide(state.settings.step); }
  });

  elements.height.addEventListener("input", () => {
    state.settings.guideHeight = Number(elements.height.value); applySettings(); saveSettings();
  });
  elements.opacity.addEventListener("input", () => {
    state.settings.opacity = Number(elements.opacity.value); applySettings(); saveSettings();
  });
  elements.focusMode.addEventListener("change", () => {
    state.settings.focus = elements.focusMode.checked; applySettings(); saveSettings();
  });
  elements.lineSnap.addEventListener("change", () => {
    state.settings.lineSnap = elements.lineSnap.checked; saveSettings();
    toast(state.settings.lineSnap ? "行スナップを有効にしました" : "手動ガイドに切り替えました");
  });
  elements.savePosition.addEventListener("change", () => {
    state.settings.save = elements.savePosition.checked; saveSettings();
    if (state.settings.save) schedulePositionSave();
  });
  $$(".color-chip").forEach((button) => button.addEventListener("click", () => {
    state.settings.color = button.dataset.color; applySettings(); saveSettings();
  }));
  $$("[data-step]").forEach((button) => button.addEventListener("click", () => {
    state.settings.step = Number(button.dataset.step); applySettings(); saveSettings();
  }));

  window.addEventListener("resize", () => setGuideY(state.guideY, false));
  applySettings();
})();
