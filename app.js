/* global faceapi, cocoSsd, tracking, JSZip, lucide */
function safelyCreateIcons() {
    try {
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
        console.warn("Lucide icons failed to load.");
    }
}
safelyCreateIcons();

function showToast(message, duration) {
    if (duration === undefined) duration = 3000;
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
        toast.style.opacity = '0';
        setTimeout(function () { toast.remove(); }, 300);
    }, duration);
}

let aiMode = 'offline';

async function initAI() {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    try {
        if (typeof faceapi !== 'undefined') {
            const FACE_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/';
            await faceapi.nets.ssdMobilenetv1.loadFromUri(FACE_MODEL_URL);
            aiMode = 'deep_learning';
        }
        if (typeof cocoSsd !== 'undefined') {
            window.cocoModel = await cocoSsd.load();
        }
        if (dot) {
            dot.classList.replace('bg-yellow-400', 'bg-green-500');
            dot.classList.remove('animate-pulse');
        }
        if (text) text.textContent = 'מערכת מוכנה';
    } catch (error) {
        console.warn("AI Model Load Error. Defaulting to offline.", error);
        aiMode = 'offline';
        if (dot) {
            dot.classList.replace('bg-yellow-400', 'bg-orange-500');
            dot.classList.remove('animate-pulse');
        }
        if (text) text.textContent = 'מערכת אופליין חלופית מוכנה';
    } finally {
        if (activeTabIndex >= 0) {
            document.getElementById('btnAutoDetect').disabled = false;
        }
    }
}
initAI();

var dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropZone.classList.add('drop-active');
});
dropZone.addEventListener('dragleave', function (e) {
    e.preventDefault();
    dropZone.classList.remove('drop-active');
});
dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('drop-active');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
    }
});

var editSessions = [];
var activeTabIndex = -1;
var fileIdCounter = 0;
var mode = 'brush';
var brushSize = 60;
var isDrawing = false;
var currentPath = null;
var isDrawingPolygon = false;
var polygonPoints = [];
var currentMousePos = null;
var view = { x: 0, y: 0, scale: 1 };
var isSpaceDown = false;
var isPanning = false;
var panStart = { x: 0, y: 0 };

var MIN_BRUSH_STEP = 2;

var workspace = document.getElementById('workspace');
var mainCanvas = document.getElementById('mainCanvas');
var mainCtx = mainCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
var blurCanvas = document.createElement('canvas');
var blurCtx = blurCanvas.getContext('2d', { willReadFrequently: true });
var maskCanvas = document.createElement('canvas');
var maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
var compCanvas = document.createElement('canvas');
var compCtx = compCanvas.getContext('2d', { willReadFrequently: true });
var brushCursor = document.getElementById('brushCursor');

var resizeObserver = new ResizeObserver(function () {
    if (activeTabIndex >= 0) {
        updateViewportSize();
        requestRender();
    }
});
resizeObserver.observe(workspace);

function updateViewportSize() {
    var w = workspace.clientWidth;
    var h = workspace.clientHeight;
    mainCanvas.width = blurCanvas.width = maskCanvas.width = compCanvas.width = w;
    mainCanvas.height = blurCanvas.height = maskCanvas.height = compCanvas.height = h;
}

var renderPending = false;
function requestRender() {
    if (!renderPending) {
        renderPending = true;
        requestAnimationFrame(function () {
            renderView();
            renderPending = false;
        });
    }
}

function drawSmoothCurve(ctx, points) {
    if (points.length < 3) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (var i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.stroke();
        return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length - 2; i++) {
        var xc = (points[i].x + points[i + 1].x) / 2;
        var yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.quadraticCurveTo(points[points.length - 2].x, points[points.length - 2].y, points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
}

function undoLastAction() {
    if (activeTabIndex < 0) return;
    var session = editSessions[activeTabIndex];
    if (session.elements.length > 0) {
        session.elements.pop();
        if (isDrawingPolygon) {
            isDrawingPolygon = false;
            polygonPoints = [];
        }
        renderTabs();
        requestRender();
        showToast("פעולה בוטלה");
    } else {
        showToast("אין פעולות לביטול");
    }
}
document.getElementById('btnUndo').addEventListener('click', undoLastAction);

async function processFiles(files) {
    if (!files || files.length === 0) return;
    showLoading("טוען תמונות...", "מכין קבצים לעבודה.");
    var loadedCount = 0;
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (file.type.startsWith('image/')) {
            try {
                var imgObj = new Image();
                await new Promise(function (resolve) {
                    imgObj.onload = resolve;
                    imgObj.onerror = function () { resolve(); };
                    imgObj.src = URL.createObjectURL(file);
                });
                if (imgObj.width > 0 && imgObj.height > 0) {
                    editSessions.push({
                        id: fileIdCounter++,
                        file: file,
                        imgObj: imgObj,
                        elements: [],
                        settings: { blurRadius: 55, featherRadius: 15 }
                    });
                    loadedCount++;
                }
            } catch (e) {
                console.error("Error loading file", file.name, e);
            }
        }
    }
    hideLoading();
    if (loadedCount > 0) {
        switchView('editor');
        updateViewportSize();
        if (activeTabIndex === -1) activeTabIndex = 0;
        else activeTabIndex = editSessions.length - 1;
        renderTabs();
        loadActiveSession();
    } else if (editSessions.length === 0) {
        showToast("לא נמצאו תמונות חוקיות.");
    }
}

function handleFileSelection(e) {
    processFiles(e.target.files).then(function () {
        e.target.value = '';
    });
}
document.getElementById('initialFileInput').addEventListener('change', handleFileSelection);
document.getElementById('folderInput').addEventListener('change', handleFileSelection);
document.getElementById('addMoreInput').addEventListener('change', handleFileSelection);

function renderTabs() {
    var container = document.getElementById('tabsContainer');
    container.innerHTML = '';
    editSessions.forEach(function (session, index) {
        var btn = document.createElement('div');
        var isActive = index === activeTabIndex;
        btn.className = 'tab-btn rounded-t-lg ' + (isActive ? 'tab-active' : 'tab-inactive border border-transparent');
        var dot = session.elements.length > 0 ? '<span class="w-2 h-2 rounded-full bg-blue-500 inline-block ml-1 shrink-0 shadow-sm"></span>' : '';
        var titleSpan = document.createElement('span');
        titleSpan.className = 'flex-1 select-none max-w-[120px] truncate block text-right';
        titleSpan.innerHTML = dot + session.file.name;
        var closeBtnWrapper = document.createElement('button');
        closeBtnWrapper.className = 'tab-close-wrapper ml-1 focus:outline-none';
        closeBtnWrapper.innerHTML = '<i data-lucide="x" class="w-3.5 h-3.5 pointer-events-none"></i>';
        btn.onclick = function () {
            if (activeTabIndex !== index) {
                isDrawingPolygon = false;
                polygonPoints = [];
                activeTabIndex = index;
                renderTabs();
                loadActiveSession();
            }
        };
        closeBtnWrapper.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeTab(index);
        };
        btn.appendChild(closeBtnWrapper);
        btn.appendChild(titleSpan);
        container.appendChild(btn);
    });
    safelyCreateIcons();
}

function closeTab(index) {
    editSessions.splice(index, 1);
    isDrawingPolygon = false;
    polygonPoints = [];
    if (editSessions.length === 0) {
        activeTabIndex = -1;
        document.getElementById('btnAutoDetect').disabled = true;
        switchView('folder');
    } else {
        if (activeTabIndex >= editSessions.length) activeTabIndex = editSessions.length - 1;
        else if (activeTabIndex === index && index > 0) activeTabIndex = index - 1;
        renderTabs();
        loadActiveSession();
    }
}

function loadActiveSession() {
    if (activeTabIndex < 0 || activeTabIndex >= editSessions.length) return;
    var session = editSessions[activeTabIndex];
    document.getElementById('blurIntensity').value = session.settings.blurRadius;
    document.getElementById('blurValueLabel').textContent = session.settings.blurRadius + 'px';
    document.getElementById('featherIntensity').value = session.settings.featherRadius;
    document.getElementById('featherValueLabel').textContent = session.settings.featherRadius + 'px';
    resetView();
    requestRender();
    document.getElementById('btnAutoDetect').disabled = false;
}

function resetView() {
    var session = editSessions[activeTabIndex];
    if (!session) return;
    var screenW = mainCanvas.width;
    var screenH = mainCanvas.height;
    var imgW = session.imgObj.width;
    var imgH = session.imgObj.height;
    var scaleX = screenW / imgW;
    var scaleY = screenH / imgH;
    view.scale = Math.min(scaleX, scaleY) * 0.95;
    view.x = (screenW - (imgW * view.scale)) / 2;
    view.y = (screenH - (imgH * view.scale)) / 2;
    requestRender();
}

workspace.addEventListener('wheel', function (e) {
    e.preventDefault();
    var zoomSensitivity = 0.001;
    var zoomFactor = Math.exp(-e.deltaY * zoomSensitivity);
    var rect = workspace.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;
    var mouseY = e.clientY - rect.top;
    view.x = mouseX - (mouseX - view.x) * zoomFactor;
    view.y = mouseY - (mouseY - view.y) * zoomFactor;
    view.scale *= zoomFactor;
    view.scale = Math.max(0.01, Math.min(view.scale, 50));
    updateBrushCursor(e);
    requestRender();
}, { passive: false });

window.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' && !isSpaceDown && activeTabIndex >= 0) {
        e.preventDefault();
        isSpaceDown = true;
        mainCanvas.style.cursor = 'grab';
        brushCursor.style.display = 'none';
    }
    if (e.code === 'Enter' && mode === 'polygon' && isDrawingPolygon) {
        finishPolygon();
    }
    if (e.key === ']') {
        brushSize = Math.min(300, parseInt(brushSize, 10) + 5);
        document.getElementById('brushSize').value = brushSize;
        document.getElementById('brushSizeLabel').textContent = brushSize + 'px';
        updateBrushCursor({ type: 'dummy' });
    }
    if (e.key === '[') {
        brushSize = Math.max(5, parseInt(brushSize, 10) - 5);
        document.getElementById('brushSize').value = brushSize;
        document.getElementById('brushSizeLabel').textContent = brushSize + 'px';
        updateBrushCursor({ type: 'dummy' });
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoLastAction();
    }
    if (e.key.toLowerCase() === 'b') activateTool('brush');
    if (e.key.toLowerCase() === 'e') activateTool('erase');
    if (e.key.toLowerCase() === 'm') activateTool('box');
    if (e.key.toLowerCase() === 'p') activateTool('polygon');
});

window.addEventListener('keyup', function (e) {
    if (e.code === 'Space') {
        isSpaceDown = false;
        isPanning = false;
        updateCursorStyle();
        updateBrushCursor({ clientX: panStart.x + view.x, clientY: panStart.y + view.y, type: 'dummy' });
    }
});

function updateCursorStyle() {
    if (mode === 'box' || mode === 'polygon') {
        mainCanvas.style.cursor = 'crosshair';
    } else {
        mainCanvas.style.cursor = 'none';
    }
}

function renderView() {
    var session = editSessions[activeTabIndex];
    if (!session) return;
    var screenW = mainCanvas.width;
    var screenH = mainCanvas.height;
    mainCtx.fillStyle = '#f3f4f6';
    mainCtx.fillRect(0, 0, screenW, screenH);
    mainCtx.save();
    mainCtx.translate(view.x, view.y);
    mainCtx.scale(view.scale, view.scale);
    mainCtx.drawImage(session.imgObj, 0, 0);
    mainCtx.restore();

    var allElements = isDrawing && currentPath ? session.elements.concat([currentPath]) : session.elements;
    if (allElements.length > 0) {
        var bleedPadding = session.settings.blurRadius * 2;
        blurCtx.clearRect(0, 0, screenW, screenH);
        blurCtx.save();
        blurCtx.translate(view.x, view.y);
        blurCtx.scale(view.scale, view.scale);
        blurCtx.filter = 'none';
        blurCtx.drawImage(session.imgObj, 0, 0);
        blurCtx.filter = 'blur(' + (session.settings.blurRadius * view.scale) + 'px)';
        blurCtx.drawImage(session.imgObj, -bleedPadding, -bleedPadding, session.imgObj.width + bleedPadding * 2, session.imgObj.height + bleedPadding * 2);
        blurCtx.restore();
        blurCtx.filter = 'none';

        maskCtx.clearRect(0, 0, screenW, screenH);
        maskCtx.filter = session.settings.featherRadius > 0 ? 'blur(' + (session.settings.featherRadius * view.scale) + 'px)' : 'none';
        maskCtx.save();
        maskCtx.translate(view.x, view.y);
        maskCtx.scale(view.scale, view.scale);
        allElements.forEach(function (el) {
            maskCtx.globalCompositeOperation = el.type === 'erase' ? 'destination-out' : 'source-over';
            maskCtx.fillStyle = maskCtx.strokeStyle = 'black';
            if (el.type === 'box') {
                maskCtx.fillRect(el.x, el.y, el.w, el.h);
            } else if (el.type === 'ellipse') {
                maskCtx.beginPath();
                maskCtx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2);
                maskCtx.fill();
            } else if (el.type === 'brush' || el.type === 'erase') {
                maskCtx.lineWidth = el.size;
                maskCtx.lineCap = 'round';
                maskCtx.lineJoin = 'round';
                if (el.points && el.points.length > 0) drawSmoothCurve(maskCtx, el.points);
            } else if (el.type === 'polygon') {
                if (el.points && el.points.length > 0) {
                    maskCtx.beginPath();
                    maskCtx.moveTo(el.points[0].x, el.points[0].y);
                    for (var i = 1; i < el.points.length; i++) {
                        maskCtx.lineTo(el.points[i].x, el.points[i].y);
                    }
                    if (isDrawingPolygon && currentMousePos && el === currentPath) {
                        maskCtx.lineTo(currentMousePos.x, currentMousePos.y);
                        maskCtx.stroke();
                    } else {
                        maskCtx.closePath();
                        maskCtx.fill();
                    }
                }
            }
        });
        maskCtx.restore();
        maskCtx.filter = 'none';

        compCtx.clearRect(0, 0, screenW, screenH);
        compCtx.globalCompositeOperation = 'source-over';
        compCtx.drawImage(maskCanvas, 0, 0);
        compCtx.globalCompositeOperation = 'source-in';
        compCtx.drawImage(blurCanvas, 0, 0);
        mainCtx.drawImage(compCanvas, 0, 0);
    }

    mainCtx.save();
    mainCtx.translate(view.x, view.y);
    mainCtx.scale(view.scale, view.scale);
    if (isDrawing && currentPath && currentPath.type === 'box') {
        mainCtx.strokeStyle = '#10b981';
        mainCtx.lineWidth = Math.max(2, 2 / view.scale);
        mainCtx.setLineDash([10 / view.scale, 10 / view.scale]);
        mainCtx.strokeRect(currentPath.x, currentPath.y, currentPath.w, currentPath.h);
        mainCtx.setLineDash([]);
    }
    if (mode === 'polygon' && isDrawingPolygon && polygonPoints.length > 0) {
        mainCtx.strokeStyle = '#3b82f6';
        mainCtx.lineWidth = Math.max(2, 2 / view.scale);
        mainCtx.beginPath();
        mainCtx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
        for (var j = 1; j < polygonPoints.length; j++) {
            mainCtx.lineTo(polygonPoints[j].x, polygonPoints[j].y);
        }
        if (currentMousePos) mainCtx.lineTo(currentMousePos.x, currentMousePos.y);
        mainCtx.stroke();
        mainCtx.fillStyle = '#1d4ed8';
        polygonPoints.forEach(function (p) {
            mainCtx.beginPath();
            mainCtx.arc(p.x, p.y, Math.max(3, 4 / view.scale), 0, Math.PI * 2);
            mainCtx.fill();
        });
    }
    mainCtx.restore();
}

function getCanvasCoords(clientX, clientY) {
    var rect = workspace.getBoundingClientRect();
    var elementX = clientX - rect.left;
    var elementY = clientY - rect.top;
    return {
        x: (elementX - view.x) / view.scale,
        y: (elementY - view.y) / view.scale
    };
}

function updateBrushCursor(e) {
    if (isSpaceDown || mode === 'box' || mode === 'polygon' || activeTabIndex < 0) {
        brushCursor.style.display = 'none';
        return;
    }
    if (e.type !== 'dummy') {
        panStart.x = e.touches ? e.touches[0].clientX : e.clientX;
        panStart.y = e.touches ? e.touches[0].clientY : e.clientY;
    }
    var rect = workspace.getBoundingClientRect();
    var visualSize = brushSize * view.scale;
    var x = panStart.x - rect.left;
    var y = panStart.y - rect.top;
    brushCursor.style.display = 'block';
    brushCursor.style.width = visualSize + 'px';
    brushCursor.style.height = visualSize + 'px';
    brushCursor.style.transform = 'translate3d(calc(' + x + 'px - 50%), calc(' + y + 'px - 50%), 0)';
    brushCursor.style.borderColor = mode === 'erase' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(255, 255, 255, 0.9)';
    brushCursor.style.backgroundColor = mode === 'erase' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.3)';
}
workspace.addEventListener('mousemove', updateBrushCursor);
workspace.addEventListener('mouseleave', function () { brushCursor.style.display = 'none'; });

function finishPolygon() {
    if (!isDrawingPolygon || polygonPoints.length < 3) {
        isDrawingPolygon = false;
        polygonPoints = [];
        requestRender();
        return;
    }
    editSessions[activeTabIndex].elements.push({ type: 'polygon', points: polygonPoints.slice() });
    isDrawingPolygon = false;
    polygonPoints = [];
    renderTabs();
    requestRender();
}
workspace.addEventListener('dblclick', function (e) {
    if (mode === 'polygon' && activeTabIndex >= 0 && isDrawingPolygon) {
        e.preventDefault();
        finishPolygon();
    }
});

workspace.addEventListener('mousedown', function (e) {
    if (activeTabIndex < 0) return;
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    if (isSpaceDown) {
        isPanning = true;
        mainCanvas.style.cursor = 'grabbing';
        panStart = { x: clientX - view.x, y: clientY - view.y };
        return;
    }
    var coords = getCanvasCoords(clientX, clientY);
    if (mode === 'polygon') {
        isDrawingPolygon = true;
        polygonPoints.push(coords);
        currentMousePos = coords;
        currentPath = { type: 'polygon', points: polygonPoints };
        requestRender();
        return;
    }
    isDrawing = true;
    if (mode === 'brush' || mode === 'erase') {
        currentPath = { type: mode, size: parseInt(brushSize, 10), points: [coords] };
    } else if (mode === 'box') {
        currentPath = { type: 'box', startX: coords.x, startY: coords.y, x: coords.x, y: coords.y, w: 0, h: 0 };
    }
    requestRender();
});

window.addEventListener('mousemove', function (e) {
    if (activeTabIndex < 0) return;
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    if (isPanning) {
        view.x = clientX - panStart.x;
        view.y = clientY - panStart.y;
        requestRender();
        return;
    }
    var coords = getCanvasCoords(clientX, clientY);
    if (mode === 'polygon' && isDrawingPolygon) {
        currentMousePos = coords;
        requestRender();
        return;
    }
    if (!isDrawing || !currentPath) return;
    if (mode === 'brush' || mode === 'erase') {
        var pts = currentPath.points;
        var last = pts[pts.length - 1];
        var dx = coords.x - last.x, dy = coords.y - last.y;
        if (dx * dx + dy * dy >= MIN_BRUSH_STEP * MIN_BRUSH_STEP) pts.push(coords);
        requestRender();
    } else if (mode === 'box') {
        currentPath.x = Math.min(coords.x, currentPath.startX);
        currentPath.y = Math.min(coords.y, currentPath.startY);
        currentPath.w = Math.abs(coords.x - currentPath.startX);
        currentPath.h = Math.abs(coords.y - currentPath.startY);
        requestRender();
    }
});

window.addEventListener('mouseup', function (e) {
    if (isPanning) {
        isPanning = false;
        updateCursorStyle();
        return;
    }
    if (mode === 'polygon') return;
    if (!isDrawing || !currentPath) return;
    isDrawing = false;
    if (mode === 'box' && (currentPath.w < 10 || currentPath.h < 10)) {
        currentPath = null;
        requestRender();
        return;
    }
    editSessions[activeTabIndex].elements.push(currentPath);
    currentPath = null;
    renderTabs();
    requestRender();
});

workspace.addEventListener('touchstart', function (e) {
    if (!isSpaceDown && mode !== 'polygon') {
        e.preventDefault();
        workspace.dispatchEvent(new MouseEvent('mousedown', { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }));
    }
}, { passive: false });
window.addEventListener('touchmove', function (e) {
    if (isDrawing || isPanning) {
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }));
    }
}, { passive: false });
window.addEventListener('touchend', function () {
    window.dispatchEvent(new MouseEvent('mouseup'));
});

function activateTool(targetMode) {
    var btn = document.querySelector('[data-mode="' + targetMode + '"]');
    if (!btn) return;
    if (mode === 'polygon' && targetMode !== 'polygon') {
        isDrawingPolygon = false;
        polygonPoints = [];
        currentPath = null;
        requestRender();
    }
    document.querySelectorAll('.tool-btn').forEach(function (b) {
        b.classList.remove('active', 'bg-white', 'text-blue-700', 'shadow-sm', 'border-blue-200');
    });
    btn.classList.add('active', 'bg-white', 'text-blue-700', 'shadow-sm', 'border', 'border-blue-200');
    mode = targetMode;
    var polyHelper = document.getElementById('polygonHelper');
    if (mode === 'polygon') polyHelper.classList.remove('hidden');
    else polyHelper.classList.add('hidden');
    updateCursorStyle();
    if (mode === 'box' || mode === 'polygon') brushCursor.style.display = 'none';
}
document.querySelectorAll('.tool-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
        activateTool(e.currentTarget.dataset.mode);
    });
});

document.getElementById('brushSize').addEventListener('input', function (e) {
    brushSize = e.target.value;
    document.getElementById('brushSizeLabel').textContent = brushSize + 'px';
    updateBrushCursor({ type: 'dummy' });
});
document.getElementById('blurIntensity').addEventListener('input', function (e) {
    if (activeTabIndex >= 0) {
        editSessions[activeTabIndex].settings.blurRadius = e.target.value;
        document.getElementById('blurValueLabel').textContent = e.target.value + 'px';
        requestRender();
    }
});
document.getElementById('featherIntensity').addEventListener('input', function (e) {
    if (activeTabIndex >= 0) {
        editSessions[activeTabIndex].settings.featherRadius = e.target.value;
        document.getElementById('featherValueLabel').textContent = e.target.value + 'px';
        requestRender();
    }
});
document.getElementById('btnClearCurrent').addEventListener('click', function () {
    if (activeTabIndex >= 0) {
        editSessions[activeTabIndex].elements = [];
        isDrawingPolygon = false;
        polygonPoints = [];
        currentPath = null;
        renderTabs();
        requestRender();
        showToast("כל הטשטושים נוקו מתמונה זו.");
    }
});

document.getElementById('btnAutoDetect').addEventListener('click', async function () {
    if (activeTabIndex < 0) return;
    var session = editSessions[activeTabIndex];
    showLoading("סורק תמונה...", "מחפש פרצופים ומסכים...");
    setTimeout(async function () {
        var detectedAny = false;
        var MAX_DIM = 1200;
        var scale = 1;
        var dW = session.imgObj.width;
        var dH = session.imgObj.height;
        if (dW > MAX_DIM || dH > MAX_DIM) {
            scale = Math.min(MAX_DIM / dW, MAX_DIM / dH);
            dW = Math.round(dW * scale);
            dH = Math.round(dH * scale);
        }
        var tempCanvas = document.createElement('canvas');
        tempCanvas.width = dW;
        tempCanvas.height = dH;
        tempCanvas.getContext('2d', { willReadFrequently: true }).drawImage(session.imgObj, 0, 0, dW, dH);

        if (window.cocoModel) {
            try {
                var objects = await window.cocoModel.detect(session.imgObj);
                var screens = ['tv', 'laptop', 'cell phone', 'monitor'];
                objects.forEach(function (obj) {
                    if (screens.indexOf(obj.class) !== -1 && obj.score > 0.4) {
                        var pX = obj.bbox[2] * 0.05;
                        var pY = obj.bbox[3] * 0.05;
                        session.elements.push({ type: 'box', x: obj.bbox[0] - pX, y: obj.bbox[1] - pY, w: obj.bbox[2] + pX * 2, h: obj.bbox[3] + pY * 2 });
                        detectedAny = true;
                    }
                });
            } catch (err) { console.warn("COCO-SSD error:", err); }
        }

        if (typeof FaceDetector !== 'undefined' && !detectedAny) {
            try {
                var detector = new FaceDetector({ fastMode: false });
                var faces = await detector.detect(session.imgObj);
                if (faces && faces.length > 0) {
                    faces.forEach(function (face) {
                        var x = face.boundingBox.x, y = face.boundingBox.y, width = face.boundingBox.width, height = face.boundingBox.height;
                        var padX = width * 0.35, padYTop = height * 0.45, padYBot = height * 0.2;
                        session.elements.push({ type: 'ellipse', x: x - padX, y: y - padYTop, w: width + padX * 2, h: height + padYTop + padYBot });
                    });
                    detectedAny = true;
                }
            } catch (err) {}
        }

        if (aiMode === 'deep_learning' && !detectedAny) {
            try {
                var options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.15, maxResults: 100 });
                var detections = await faceapi.detectAllFaces(tempCanvas, options);
                if (detections && detections.length > 0) {
                    detections.forEach(function (det) {
                        var box = det.box;
                        var origX = box.x / scale, origY = box.y / scale, origW = box.width / scale, origH = box.height / scale;
                        var padX = origW * 0.35, padYTop = origH * 0.45, padYBot = origH * 0.2;
                        session.elements.push({
                            type: 'ellipse',
                            x: origX - padX, y: origY - padYTop, w: origW + padX * 2, h: origH + padYTop + padYBot
                        });
                    });
                    detectedAny = true;
                }
            } catch (err) {}
        }

        if (!detectedAny && typeof tracking !== 'undefined') {
            try {
                var tracker = new tracking.ObjectTracker('face');
                tracker.setInitialScale(1.5);
                tracker.setStepSize(1.2);
                tracker.setEdgesDensity(0.1);
                await new Promise(function (resolve) {
                    var task = tracking.track(tempCanvas, tracker);
                    tracker.on('track', function (event) {
                        task.stop();
                        if (event.data && event.data.length > 0) {
                            event.data.forEach(function (rect) {
                                var origX = rect.x / scale, origY = rect.y / scale, origW = rect.width / scale, origH = rect.height / scale;
                                var padX = origW * 0.35, padYTop = origH * 0.45, padYBot = origH * 0.2;
                                session.elements.push({ type: 'ellipse', x: origX - padX, y: origY - padYTop, w: origW + padX * 2, h: origH + padYTop + padYBot });
                            });
                            detectedAny = true;
                        }
                        resolve();
                    });
                    setTimeout(resolve, 3000);
                });
            } catch (err) {}
        }

        hideLoading();
        if (detectedAny) {
            renderTabs();
            requestRender();
            showToast("סריקה וזיהוי הושלמו בהצלחה!");
        } else {
            showToast("לא נמצאו אובייקטים לטשטוש. נא להשתמש בכלים הידניים.");
        }
    }, 100);
});

async function renderSessionToCanvas(session) {
    var exportCanvas = document.createElement('canvas');
    var w = session.imgObj.width;
    var h = session.imgObj.height;
    exportCanvas.width = w;
    exportCanvas.height = h;
    var eCtx = exportCanvas.getContext('2d');
    eCtx.drawImage(session.imgObj, 0, 0);

    if (session.elements.length > 0) {
        var expBlur = document.createElement('canvas');
        expBlur.width = w;
        expBlur.height = h;
        var bCtx = expBlur.getContext('2d');
        var bleedPadding = session.settings.blurRadius * 3;
        bCtx.filter = 'none';
        bCtx.drawImage(session.imgObj, 0, 0);
        bCtx.filter = 'blur(' + session.settings.blurRadius + 'px)';
        bCtx.drawImage(session.imgObj, -bleedPadding, -bleedPadding, w + bleedPadding * 2, h + bleedPadding * 2);
        bCtx.filter = 'none';

        var expMask = document.createElement('canvas');
        expMask.width = w;
        expMask.height = h;
        var mCtx = expMask.getContext('2d');
        mCtx.filter = session.settings.featherRadius > 0 ? 'blur(' + session.settings.featherRadius + 'px)' : 'none';
        session.elements.forEach(function (el) {
            mCtx.globalCompositeOperation = el.type === 'erase' ? 'destination-out' : 'source-over';
            mCtx.fillStyle = mCtx.strokeStyle = 'black';
            if (el.type === 'box') mCtx.fillRect(el.x, el.y, el.w, el.h);
            else if (el.type === 'ellipse') {
                mCtx.beginPath();
                mCtx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2);
                mCtx.fill();
            } else if (el.type === 'brush' || el.type === 'erase') {
                mCtx.lineWidth = el.size;
                mCtx.lineCap = 'round';
                mCtx.lineJoin = 'round';
                if (el.points && el.points.length > 0) drawSmoothCurve(mCtx, el.points);
            } else if (el.type === 'polygon' && el.points && el.points.length > 2) {
                mCtx.beginPath();
                mCtx.moveTo(el.points[0].x, el.points[0].y);
                for (var j = 1; j < el.points.length; j++) mCtx.lineTo(el.points[j].x, el.points[j].y);
                mCtx.closePath();
                mCtx.fill();
            }
        });
        mCtx.globalCompositeOperation = 'source-in';
        mCtx.drawImage(expBlur, 0, 0);
        eCtx.drawImage(expMask, 0, 0);
    }
    return exportCanvas;
}

document.getElementById('btnSaveSingle').addEventListener('click', async function () {
    if (activeTabIndex < 0) return;
    var session = editSessions[activeTabIndex];
    var outName = session.file.name;
    if (outName.toLowerCase().indexOf('.jpg') === -1 && outName.toLowerCase().indexOf('.jpeg') === -1) {
        outName += '.jpg';
    }
    outName = "מטושטש_" + outName;

    if (window.electronAPI) {
        showLoading("שומר תמונה...", "מכין תמונה לייצוא.");
        try {
            var canvas = await renderSessionToCanvas(session);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            var result = await window.electronAPI.saveImage(dataUrl, outName);
            if (result && !result.canceled) {
                showToast("התמונה נשמרה בהצלחה!");
            }
        } catch (err) {
            console.error(err);
            showToast("שגיאה בשמירת התמונה.");
        }
        hideLoading();
        return;
    }

    try {
        var options = {
            suggestedName: outName,
            types: [{ description: 'JPEG Image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }],
        };
        var fileHandle;
        try {
            fileHandle = await window.showSaveFilePicker(options);
        } catch (e) {
            if (e.name !== 'AbortError') console.warn("Save picker unsupported.");
            else return;
        }
        showLoading("שומר תמונה...", "מכין תמונה לייצוא.");
        setTimeout(async function () {
            try {
                var canvas = await renderSessionToCanvas(session);
                if (fileHandle) {
                    var blob = await new Promise(function (resolve) {
                        canvas.toBlob(resolve, 'image/jpeg', 0.95);
                    });
                    var writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                } else {
                    var dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                    var link = document.createElement('a');
                    link.href = dataUrl;
                    link.download = outName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
                showToast("התמונה נשמרה בהצלחה!");
            } catch (e) {
                showToast("שגיאה בשמירת התמונה.");
            }
            hideLoading();
        }, 50);
    } catch (err) {
        console.error(err);
    }
});

document.getElementById('btnSaveAll').addEventListener('click', async function () {
    if (editSessions.length === 0) return;

    if (window.electronAPI) {
        showLoading("שומר נתונים ברזולוציה מקורית...", "מייצא את התמונות ל-ZIP.");
        try {
            var zip = new JSZip();
            var imgFolder = zip.folder("מטושטש");
            for (var i = 0; i < editSessions.length; i++) {
                var session = editSessions[i];
                var exportCanvas = await renderSessionToCanvas(session);
                var dataUrl = exportCanvas.toDataURL('image/jpeg', 0.95);
                var base64Data = dataUrl.split(',')[1];
                var outName = session.file.name;
                if (outName.toLowerCase().indexOf('.jpg') === -1 && outName.toLowerCase().indexOf('.jpeg') === -1) outName += '.jpg';
                imgFolder.file(outName, base64Data, { base64: true });
            }
            var content = await zip.generateAsync({ type: "arraybuffer" });
            var result = await window.electronAPI.saveZip(new Uint8Array(content), 'מטושטש.zip');
            if (result && !result.canceled) {
                showToast("קובץ ה-ZIP נשמר בהצלחה!");
            }
        } catch (err) {
            console.error(err);
            showToast("אירעה שגיאה ביצירת קובץ ה-ZIP.");
        }
        hideLoading();
        return;
    }

    try {
        var options = {
            suggestedName: 'מטושטש.zip',
            types: [{ description: 'ZIP File', accept: { 'application/zip': ['.zip'] } }],
        };
        var fileHandle;
        try {
            fileHandle = await window.showSaveFilePicker(options);
        } catch (e) {
            if (e.name !== 'AbortError') console.warn("Save picker unsupported.");
            else return;
        }
        showLoading("שומר נתונים ברזולוציה מקורית...", "מייצא את התמונות לאיכות המקסימלית ומארז ב-ZIP.");
        setTimeout(async function () {
            try {
                var zip = new JSZip();
                var imgFolder = zip.folder("מטושטש");
                for (var i = 0; i < editSessions.length; i++) {
                    var session = editSessions[i];
                    var exportCanvas = await renderSessionToCanvas(session);
                    var dataUrl = exportCanvas.toDataURL('image/jpeg', 0.95);
                    var base64Data = dataUrl.split(',')[1];
                    var outName = session.file.name;
                    if (outName.toLowerCase().indexOf('.jpg') === -1 && outName.toLowerCase().indexOf('.jpeg') === -1) outName += '.jpg';
                    imgFolder.file(outName, base64Data, { base64: true });
                }
                var content = await zip.generateAsync({ type: "blob" });
                if (fileHandle) {
                    var writable = await fileHandle.createWritable();
                    await writable.write(content);
                    await writable.close();
                } else {
                    var link = document.createElement('a');
                    link.href = URL.createObjectURL(content);
                    link.download = "מטושטש.zip";
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
                showToast("קובץ ה-ZIP נשמר בהצלחה!");
            } catch (err) {
                showToast("אירעה שגיאה ביצירת קובץ ה-ZIP.");
            }
            hideLoading();
        }, 100);
    } catch (err) {
        console.error(err);
    }
});

function switchView(viewName) {
    [document.getElementById('viewFolder'), document.getElementById('viewEditor')].forEach(function (v) {
        v.classList.add('hidden');
    });
    if (viewName === 'folder') document.getElementById('viewFolder').classList.remove('hidden');
    if (viewName === 'editor') document.getElementById('viewEditor').classList.remove('hidden');
}
function showLoading(title, desc) {
    document.getElementById('loadingTitle').textContent = title;
    document.getElementById('loadingDesc').textContent = desc;
    document.getElementById('loadingOverlay').classList.remove('hidden');
}
function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}
