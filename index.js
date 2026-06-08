        import { renderSVG } from "./uqr@0.1.3/es2022/uqr.js";

        const Html5QrcodeLib = window.Html5Qrcode;

        const tabButtons = [...document.querySelectorAll('.tab-button')];
        const generatorPanel = document.getElementById('generator-panel');
        const parserPanel = document.getElementById('parser-panel');

        const generateBtn = document.getElementById('generateBtn');
        const clearBtn = document.getElementById('clearBtn');
        const textInput = document.getElementById('text-input');
        const qrContainer = document.getElementById('qrcode-container');

        const imageInput = document.getElementById('imageInput');
        const pickImageBtn = document.getElementById('pickImageBtn');
        const dropZone = document.getElementById('dropZone');
        const dropZoneContent = document.getElementById('dropZoneContent');
        const cameraPanel = document.getElementById('cameraPanel');
        const startCameraBtn = document.getElementById('startCameraBtn');
        const stopCameraBtn = document.getElementById('stopCameraBtn');
        const cameraSelectWrap = document.getElementById('cameraSelectWrap');
        const cameraSelect = document.getElementById('cameraSelect');
        const cameraStatus = document.getElementById('cameraStatus');
        const cameraReader = document.getElementById('camera-reader');
        const parseStatus = document.getElementById('parseStatus');
        const resultMeta = document.getElementById('resultMeta');
        const resultSource = document.getElementById('resultSource');
        const resultFormat = document.getElementById('resultFormat');
        const decodedText = document.getElementById('decodedText');
        const copyResultBtn = document.getElementById('copyResultBtn');

        let cameraScanner = null;
        let cameraRunning = false;
        let decodeInProgress = false;
        let latestDecodedValue = '';
        let lastCameraDecodedValue = '';
        let availableCameras = [];
        let isInitializingCamera = false;
        let cameraControlState = createDefaultCameraControlState();
        let cameraFocusIndicatorTimer = null;

        function createDefaultCameraControlState() {
            return {
                track: null,
                video: null,
                hardwareZoomSupported: false,
                zoomMin: 1,
                zoomMax: 4,
                zoomStep: 0.08,
                currentZoom: 1,
                previewZoom: 1,
                focusModes: [],
                pointsOfInterestSupported: false,
                activePointers: new Map(),
                pinchActive: false,
                pinchStartDistance: 0,
                pinchStartZoom: 1,
                pointerDown: null,
                pendingZoom: null,
                zoomUpdateInFlight: false,
                focusNoticeShown: false,
                gestureStartZoom: 1
            };
        }

        function setParseStatus(message, tone = 'warning') {
            parseStatus.textContent = message;
            parseStatus.dataset.tone = tone;
        }

        function setResult(text, source, formatLabel) {
            latestDecodedValue = text;
            resultMeta.hidden = false;
            resultSource.textContent = source;
            resultFormat.textContent = formatLabel;
            decodedText.textContent = text;
            copyResultBtn.disabled = !text;
        }

        function resetResult() {
            latestDecodedValue = '';
            resultMeta.hidden = true;
            decodedText.textContent = '尚無資料';
            copyResultBtn.disabled = true;
        }

        function setCameraPlaceholder(message = '鏡頭畫面會顯示在這裡') {
            cameraReader.style.setProperty('--camera-preview-scale', '1');
            cameraReader.innerHTML = `
                <p class="camera-placeholder">${message}</p>
                <div class="camera-focus-indicator" aria-hidden="true"></div>
            `;
        }

        function getCameraVideoElement() {
            return cameraReader.querySelector('video');
        }

        function getCameraFocusIndicatorElement() {
            return cameraReader.querySelector('.camera-focus-indicator');
        }

        function getCameraTrack() {
            const video = getCameraVideoElement();
            const stream = video?.srcObject;

            if (!stream || typeof stream.getVideoTracks !== 'function') {
                return null;
            }

            return stream.getVideoTracks()[0] || null;
        }

        function hideCameraPlaceholder() {
            const placeholder = cameraReader.querySelector('.camera-placeholder');

            if (placeholder) {
                placeholder.hidden = true;
            }
        }

        function clampValue(value, min, max) {
            return Math.min(max, Math.max(min, value));
        }

        function resetCameraPreviewScale() {
            cameraReader.style.setProperty('--camera-preview-scale', '1');

            const video = getCameraVideoElement();
            if (video) {
                video.style.transformOrigin = 'center center';
            }
        }

        function getCurrentCameraZoomLevel() {
            return cameraControlState.hardwareZoomSupported
                ? cameraControlState.currentZoom
                : cameraControlState.previewZoom;
        }

        function snapCameraZoomValue(value) {
            const { zoomMin, zoomMax, zoomStep } = cameraControlState;
            const clampedValue = clampValue(value, zoomMin, zoomMax);

            if (!Number.isFinite(zoomStep) || zoomStep <= 0) {
                return clampedValue;
            }

            const steps = Math.round((clampedValue - zoomMin) / zoomStep);
            return clampValue(zoomMin + (steps * zoomStep), zoomMin, zoomMax);
        }

        function getCameraInteractionRect() {
            return getCameraVideoElement()?.getBoundingClientRect() || cameraReader.getBoundingClientRect();
        }

        function updateCameraTransformOrigin(clientX, clientY) {
            const video = getCameraVideoElement();

            if (!video) {
                return;
            }

            const rect = getCameraInteractionRect();
            const originX = clampValue(((clientX - rect.left) / rect.width) * 100, 0, 100);
            const originY = clampValue(((clientY - rect.top) / rect.height) * 100, 0, 100);

            video.style.transformOrigin = `${originX}% ${originY}%`;
        }

        function applyDigitalPreviewZoom(zoomLevel) {
            const nextZoom = clampValue(zoomLevel, cameraControlState.zoomMin, cameraControlState.zoomMax);
            cameraControlState.previewZoom = nextZoom;
            cameraReader.style.setProperty('--camera-preview-scale', nextZoom.toFixed(3));
        }

        function clearCameraFocusIndicator() {
            if (cameraFocusIndicatorTimer) {
                window.clearTimeout(cameraFocusIndicatorTimer);
                cameraFocusIndicatorTimer = null;
            }

            const indicator = getCameraFocusIndicatorElement();
            if (indicator) {
                indicator.classList.remove('is-visible');
            }
        }

        function showCameraFocusIndicator(clientX, clientY) {
            const indicator = getCameraFocusIndicatorElement();

            if (!indicator) {
                return;
            }

            const bounds = cameraReader.getBoundingClientRect();
            const left = clampValue(clientX - bounds.left, 0, bounds.width);
            const top = clampValue(clientY - bounds.top, 0, bounds.height);

            indicator.style.left = `${left}px`;
            indicator.style.top = `${top}px`;
            indicator.classList.remove('is-visible');
            void indicator.offsetWidth;
            indicator.classList.add('is-visible');

            if (cameraFocusIndicatorTimer) {
                window.clearTimeout(cameraFocusIndicatorTimer);
            }

            cameraFocusIndicatorTimer = window.setTimeout(() => {
                indicator.classList.remove('is-visible');
            }, 900);
        }

        async function applyCameraZoom(targetZoom) {
            const track = cameraControlState.track || getCameraTrack();

            if (cameraControlState.hardwareZoomSupported && track) {
                const nextZoom = snapCameraZoomValue(targetZoom);

                if (Math.abs(nextZoom - cameraControlState.currentZoom) < 0.001) {
                    return;
                }

                try {
                    await track.applyConstraints({ advanced: [{ zoom: nextZoom }] });
                    cameraControlState.currentZoom = nextZoom;
                    resetCameraPreviewScale();
                    return;
                } catch (error) {
                    console.warn('硬體 zoom 套用失敗，改用預覽縮放:', error);
                    cameraControlState.hardwareZoomSupported = false;
                    cameraControlState.zoomMin = 1;
                    cameraControlState.zoomMax = 4;
                    cameraControlState.zoomStep = 0.08;
                    cameraControlState.previewZoom = 1;
                }
            }

            applyDigitalPreviewZoom(targetZoom);
        }

        async function flushPendingCameraZoom() {
            if (cameraControlState.zoomUpdateInFlight) {
                return;
            }

            cameraControlState.zoomUpdateInFlight = true;

            try {
                while (cameraControlState.pendingZoom !== null) {
                    const nextZoom = cameraControlState.pendingZoom;
                    cameraControlState.pendingZoom = null;
                    await applyCameraZoom(nextZoom);
                }
            } finally {
                cameraControlState.zoomUpdateInFlight = false;
            }
        }

        function queueCameraZoom(targetZoom, origin = null) {
            if (!cameraRunning || isInitializingCamera) {
                return;
            }

            if (origin) {
                updateCameraTransformOrigin(origin.clientX, origin.clientY);
            }

            cameraControlState.pendingZoom = targetZoom;

            if (!cameraControlState.zoomUpdateInFlight) {
                void flushPendingCameraZoom();
            }
        }

        function getPointerDistance(points) {
            if (points.length < 2) {
                return 0;
            }

            return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        }

        function getPointerMidpoint(points) {
            if (points.length < 2) {
                return null;
            }

            return {
                clientX: (points[0].x + points[1].x) / 2,
                clientY: (points[0].y + points[1].y) / 2
            };
        }

        async function focusCameraAtPoint(clientX, clientY) {
            if (!cameraRunning) {
                return;
            }

            const track = cameraControlState.track || getCameraTrack();
            if (!track) {
                return;
            }

            showCameraFocusIndicator(clientX, clientY);

            const rect = getCameraInteractionRect();
            const pointOfInterest = {
                x: clampValue((clientX - rect.left) / rect.width, 0, 1),
                y: clampValue((clientY - rect.top) / rect.height, 0, 1)
            };
            const advancedConstraint = {};

            if (cameraControlState.pointsOfInterestSupported) {
                advancedConstraint.pointsOfInterest = [pointOfInterest];
            }

            if (cameraControlState.focusModes.includes('single-shot')) {
                advancedConstraint.focusMode = 'single-shot';
            } else if (cameraControlState.focusModes.includes('continuous')) {
                advancedConstraint.focusMode = 'continuous';
            }

            if (!Object.keys(advancedConstraint).length) {
                if (!cameraControlState.focusNoticeShown) {
                    cameraControlState.focusNoticeShown = true;
                    setParseStatus('目前裝置不支援點擊對焦，已保留滾輪與手勢縮放。', 'warning');
                }
                return;
            }

            try {
                await track.applyConstraints({ advanced: [advancedConstraint] });
            } catch (error) {
                console.warn('點擊對焦失敗:', error);

                if (!cameraControlState.focusNoticeShown) {
                    cameraControlState.focusNoticeShown = true;
                    setParseStatus('鏡頭不接受點擊對焦指令，已保留縮放操作。', 'warning');
                }
            }
        }

        async function enableDefaultCameraFocusMode() {
            const track = cameraControlState.track;

            if (!track) {
                return;
            }

            if (cameraControlState.focusModes.includes('continuous')) {
                try {
                    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
                } catch (error) {
                    console.warn('啟用連續自動對焦失敗:', error);
                }
            }
        }

        async function initializeCameraControlState() {
            cameraControlState = createDefaultCameraControlState();
            resetCameraPreviewScale();
            hideCameraPlaceholder();

            const video = getCameraVideoElement();
            const track = getCameraTrack();

            cameraControlState.video = video;
            cameraControlState.track = track;

            if (!track) {
                return;
            }

            const capabilities = typeof track.getCapabilities === 'function'
                ? track.getCapabilities()
                : {};
            const settings = typeof track.getSettings === 'function'
                ? track.getSettings()
                : {};
            const zoomCapability = capabilities?.zoom;

            if (zoomCapability && typeof zoomCapability.min === 'number' && typeof zoomCapability.max === 'number') {
                cameraControlState.hardwareZoomSupported = true;
                cameraControlState.zoomMin = zoomCapability.min;
                cameraControlState.zoomMax = zoomCapability.max;
                cameraControlState.zoomStep = zoomCapability.step || 0.1;
                cameraControlState.currentZoom = typeof settings.zoom === 'number'
                    ? settings.zoom
                    : clampValue(1, cameraControlState.zoomMin, cameraControlState.zoomMax);
            } else {
                cameraControlState.hardwareZoomSupported = false;
                cameraControlState.zoomMin = 1;
                cameraControlState.zoomMax = 4;
                cameraControlState.zoomStep = 0.08;
                cameraControlState.previewZoom = 1;
            }

            cameraControlState.focusModes = Array.isArray(capabilities?.focusMode)
                ? capabilities.focusMode.filter((mode) => typeof mode === 'string')
                : [];
            cameraControlState.pointsOfInterestSupported = 'pointsOfInterest' in capabilities;

            await enableDefaultCameraFocusMode();
        }

        function handleCameraWheelZoom(event) {
            if (!cameraRunning) {
                return;
            }

            event.preventDefault();

            const zoomDelta = event.deltaY < 0
                ? Math.max(cameraControlState.zoomStep, 0.1)
                : -Math.max(cameraControlState.zoomStep, 0.1);

            queueCameraZoom(getCurrentCameraZoomLevel() + zoomDelta, {
                clientX: event.clientX,
                clientY: event.clientY
            });
        }

        function handleCameraPointerDown(event) {
            if (!cameraRunning) {
                return;
            }

            if (event.pointerType === 'mouse' && event.button !== 0) {
                return;
            }

            event.preventDefault();
            cameraReader.setPointerCapture?.(event.pointerId);

            cameraControlState.activePointers.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY
            });

            if (cameraControlState.activePointers.size === 1) {
                cameraControlState.pointerDown = {
                    id: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    moved: false
                };
                cameraControlState.pinchActive = false;
                return;
            }

            const points = [...cameraControlState.activePointers.values()].slice(0, 2);
            cameraControlState.pointerDown = null;
            cameraControlState.pinchActive = true;
            cameraControlState.pinchStartDistance = getPointerDistance(points);
            cameraControlState.pinchStartZoom = getCurrentCameraZoomLevel();
        }

        function handleCameraPointerMove(event) {
            if (!cameraRunning || !cameraControlState.activePointers.has(event.pointerId)) {
                return;
            }

            event.preventDefault();

            cameraControlState.activePointers.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY
            });

            if (cameraControlState.activePointers.size >= 2) {
                const points = [...cameraControlState.activePointers.values()].slice(0, 2);
                const distance = getPointerDistance(points);

                if (!distance || !cameraControlState.pinchStartDistance) {
                    return;
                }

                cameraControlState.pinchActive = true;
                const midpoint = getPointerMidpoint(points);
                const nextZoom = cameraControlState.pinchStartZoom * (distance / cameraControlState.pinchStartDistance);
                queueCameraZoom(nextZoom, midpoint);
                return;
            }

            if (cameraControlState.pointerDown?.id === event.pointerId) {
                const distanceFromStart = Math.hypot(
                    event.clientX - cameraControlState.pointerDown.startX,
                    event.clientY - cameraControlState.pointerDown.startY
                );

                if (distanceFromStart > 10) {
                    cameraControlState.pointerDown.moved = true;
                }
            }
        }

        function handleCameraPointerEnd(event) {
            if (!cameraControlState.activePointers.has(event.pointerId)) {
                return;
            }

            const shouldFocus = Boolean(
                cameraControlState.pointerDown
                && cameraControlState.pointerDown.id === event.pointerId
                && !cameraControlState.pointerDown.moved
                && !cameraControlState.pinchActive
            );
            const tapPoint = {
                clientX: event.clientX,
                clientY: event.clientY
            };

            cameraControlState.activePointers.delete(event.pointerId);

            if (cameraControlState.pointerDown?.id === event.pointerId) {
                cameraControlState.pointerDown = null;
            }

            if (cameraControlState.activePointers.size < 2) {
                cameraControlState.pinchActive = false;
                cameraControlState.pinchStartDistance = 0;
                cameraControlState.pinchStartZoom = getCurrentCameraZoomLevel();
            }

            cameraReader.releasePointerCapture?.(event.pointerId);

            if (shouldFocus && event.type === 'pointerup') {
                void focusCameraAtPoint(tapPoint.clientX, tapPoint.clientY);
            }
        }

        function handleCameraGestureStart(event) {
            if (!cameraRunning) {
                return;
            }

            event.preventDefault();
            cameraControlState.gestureStartZoom = getCurrentCameraZoomLevel();
        }

        function handleCameraGestureChange(event) {
            if (!cameraRunning) {
                return;
            }

            event.preventDefault();

            const referenceRect = getCameraInteractionRect();
            queueCameraZoom(cameraControlState.gestureStartZoom * (event.scale || 1), {
                clientX: event.clientX || (referenceRect.left + (referenceRect.width / 2)),
                clientY: event.clientY || (referenceRect.top + (referenceRect.height / 2))
            });
        }

        function handleCameraGestureEnd(event) {
            if (!cameraRunning) {
                return;
            }

            event.preventDefault();
            cameraControlState.gestureStartZoom = getCurrentCameraZoomLevel();
        }

        function handleCameraTouchMove(event) {
            if (!cameraRunning) {
                return;
            }

            if (event.touches.length > 1) {
                event.preventDefault();
            }
        }

        function setInputMode(mode) {
            const isCameraMode = mode === 'camera';

            dropZone.classList.toggle('is-camera-mode', isCameraMode);
            dropZoneContent.hidden = isCameraMode;
            cameraPanel.hidden = !isCameraMode;
            dropZone.tabIndex = isCameraMode ? -1 : 0;
        }

        function resetCameraSelection() {
            availableCameras = [];
            cameraSelect.innerHTML = '';
            cameraSelectWrap.hidden = true;
        }

        function getCameraId(camera) {
            return camera.id || camera.deviceId;
        }

        function getCameraLabel(camera, index) {
            return camera.label || `鏡頭 ${index + 1}`;
        }

        function populateCameraSelection(cameras, selectedId) {
            availableCameras = cameras;

            if (cameras.length <= 1) {
                cameraSelect.innerHTML = '';
                cameraSelectWrap.hidden = true;
                return;
            }

            cameraSelect.innerHTML = '';

            cameras.forEach((camera, index) => {
                const option = document.createElement('option');
                option.value = getCameraId(camera);
                option.textContent = getCameraLabel(camera, index);
                cameraSelect.appendChild(option);
            });

            cameraSelect.value = selectedId;
            cameraSelectWrap.hidden = false;
        }

        function resolveFormatLabel(payload) {
            const candidates = [payload?.result?.format, payload?.format];

            for (const candidate of candidates) {
                if (!candidate) {
                    continue;
                }

                if (typeof candidate.formatName === 'string' && candidate.formatName.trim()) {
                    return candidate.formatName;
                }

                if (typeof candidate === 'string' && candidate.trim()) {
                    return candidate;
                }

                if (typeof candidate.toString === 'function') {
                    const label = candidate.toString();
                    if (label && label !== '[object Object]') {
                        return label;
                    }
                }
            }

            return '未知';
        }

        function generateQRCode() {
            const text = textInput.value.trim();

            qrContainer.innerHTML = '';

            if (!text) {
                qrContainer.textContent = '請先輸入內容';
                return;
            }

            try {
                const svgString = renderSVG(text, {
                    ecc: 'H',
                    blackColor: '#000000',
                    whiteColor: '#ffffff',
                    border: 1
                });

                qrContainer.innerHTML = svgString;
            } catch (error) {
                console.error('QR Code 產生失敗:', error);
                qrContainer.textContent = '產生失敗，資料可能過長或格式錯誤。';
            }
        }

        function clearGenerator() {
            textInput.value = '';
            qrContainer.innerHTML = '';
        }

        async function copyDecodedResult() {
            if (!latestDecodedValue) {
                return;
            }

            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(latestDecodedValue);
                } else {
                    const helper = document.createElement('textarea');
                    helper.value = latestDecodedValue;
                    helper.setAttribute('readonly', 'readonly');
                    helper.style.position = 'fixed';
                    helper.style.left = '-9999px';
                    document.body.appendChild(helper);
                    helper.select();
                    document.execCommand('copy');
                    document.body.removeChild(helper);
                }

                setParseStatus('解析結果已複製到剪貼簿。', 'success');
            } catch (error) {
                console.error('複製失敗:', error);
                setParseStatus('無法寫入剪貼簿，請手動複製下方結果。', 'error');
            }
        }

        function getImageFile(files) {
            return [...files].find((file) => file.type.startsWith('image/')) || null;
        }

        async function decodeImageFile(file, sourceLabel) {
            if (!Html5QrcodeLib) {
                setParseStatus('html5-qrcode 載入失敗，請確認本機函式庫路徑是否正確。', 'error');
                return;
            }

            if (!file || !file.type.startsWith('image/')) {
                setParseStatus('請提供圖片檔案後再解析。', 'error');
                return;
            }

            if (decodeInProgress) {
                setParseStatus('已有解析作業進行中，請稍候片刻。', 'warning');
                return;
            }

            if (cameraRunning || !cameraPanel.hidden) {
                await stopCameraScan({ silent: true });
            }

            decodeInProgress = true;
            setParseStatus(`${sourceLabel}解析中...`, 'warning');

            const fileScanner = new Html5QrcodeLib('file-decoder');

            try {
                const result = typeof fileScanner.scanFileV2 === 'function'
                    ? await fileScanner.scanFileV2(file, false)
                    : { decodedText: await fileScanner.scanFile(file, false), result: null };

                const text = typeof result === 'string' ? result : result?.decodedText;

                if (!text) {
                    throw new Error('EMPTY_RESULT');
                }

                setResult(text, sourceLabel, resolveFormatLabel(result));
                setParseStatus('解析完成。', 'success');
            } catch (error) {
                console.error('圖片解析失敗:', error);
                setParseStatus('解析失敗，請確認圖片內含清楚可辨識的 QR Code 或條碼。', 'error');
            } finally {
                fileScanner.clear();
                decodeInProgress = false;
            }
        }

        function pickPreferredCamera(cameras) {
            const preferredKeywords = ['back', 'rear', 'environment', '後', '后'];

            return cameras.find((camera) => {
                const label = (camera.label || '').toLowerCase();
                return preferredKeywords.some((keyword) => label.includes(keyword));
            }) || cameras[0];
        }

        function getQrBoxSize() {
            const availableWidth = Math.max(cameraReader.clientWidth || 320, 220);
            const size = Math.max(180, Math.min(280, Math.floor(availableWidth * 0.72)));

            return { width: size, height: size };
        }

        async function stopCameraScan({ silent = false, keepCameraPanel = false, keepCameraList = false, statusText = '尚未啟動鏡頭。' } = {}) {
            stopCameraBtn.disabled = true;

            const scanner = cameraScanner;
            cameraScanner = null;
            cameraRunning = false;
            isInitializingCamera = false;
            lastCameraDecodedValue = '';
            cameraControlState = createDefaultCameraControlState();
            clearCameraFocusIndicator();

            if (scanner) {
                try {
                    await scanner.stop();
                } catch (error) {
                    console.warn('停止鏡頭時發生錯誤:', error);
                }

                scanner.clear();
            }

            if (!keepCameraList) {
                resetCameraSelection();
            }

            if (!keepCameraPanel) {
                setInputMode('image');
            }

            startCameraBtn.disabled = false;
            stopCameraBtn.disabled = true;
            cameraStatus.textContent = statusText;
            setCameraPlaceholder();

            if (!silent) {
                setParseStatus('鏡頭已停止。', 'warning');
            }
        }

        async function restartCameraScan(cameraId) {
            if (!cameraId || isInitializingCamera) {
                return;
            }

            await stopCameraScan({
                silent: true,
                keepCameraPanel: true,
                keepCameraList: true,
                statusText: '正在切換鏡頭...'
            });

            await startCameraScan(cameraId, { reuseCameraList: true });
        }

        async function startCameraScan(cameraIdOverride = null, { reuseCameraList = false } = {}) {
            if (!Html5QrcodeLib) {
                setParseStatus('html5-qrcode 載入失敗，無法啟動鏡頭。', 'error');
                return;
            }

            if (cameraRunning || isInitializingCamera) {
                return;
            }

            isInitializingCamera = true;
            setInputMode('camera');
            startCameraBtn.disabled = true;
            stopCameraBtn.disabled = true;
            setParseStatus('正在準備鏡頭，接下來才會由瀏覽器要求權限。', 'warning');
            cameraStatus.textContent = reuseCameraList ? '正在啟動選定鏡頭...' : '正在查找可用鏡頭...';
            setCameraPlaceholder('鏡頭畫面準備中...');

            try {
                const cameras = reuseCameraList && availableCameras.length > 0
                    ? availableCameras
                    : await Html5QrcodeLib.getCameras();

                if (!cameras || cameras.length === 0) {
                    throw new Error('NO_CAMERA');
                }

                const selectedCamera = cameraIdOverride
                    ? cameras.find((camera) => getCameraId(camera) === cameraIdOverride) || pickPreferredCamera(cameras)
                    : pickPreferredCamera(cameras);
                const cameraId = getCameraId(selectedCamera);

                populateCameraSelection(cameras, cameraId);
                cameraStatus.textContent = `鏡頭啟動中：${selectedCamera.label || '預設鏡頭'}`;

                cameraScanner = new Html5QrcodeLib('camera-reader');

                await cameraScanner.start(
                    cameraId,
                    {
                        fps: 10,
                        qrbox: getQrBoxSize(),
                        aspectRatio: 1.3333333333
                    },
                    (decodedValue, decodedResult) => {
                        if (decodedValue === lastCameraDecodedValue) {
                            return;
                        }

                        lastCameraDecodedValue = decodedValue;
                        setResult(decodedValue, '鏡頭即時讀取', resolveFormatLabel(decodedResult));
                        setParseStatus('辨識成功，鏡頭已自動關閉。', 'success');
                        cameraStatus.textContent = '已完成辨識，正在關閉鏡頭...';
                        void stopCameraScan({ silent: true, statusText: '已完成辨識。' });
                    },
                    () => {
                        // 掃描進行中時找不到碼屬於正常情況，無需持續刷錯誤訊息。
                    }
                );

                cameraRunning = true;
                isInitializingCamera = false;
                await initializeCameraControlState();
                stopCameraBtn.disabled = false;
                cameraStatus.textContent = `鏡頭已啟動：${getCameraLabel(selectedCamera, cameras.indexOf(selectedCamera))}`;
                setParseStatus('鏡頭已啟動，請把 QR Code 或條碼對準畫面中央。', 'success');
            } catch (error) {
                console.error('鏡頭啟動失敗:', error);

                if (cameraScanner) {
                    cameraScanner.clear();
                    cameraScanner = null;
                }

                cameraRunning = false;
                isInitializingCamera = false;
                startCameraBtn.disabled = false;
                stopCameraBtn.disabled = true;
                resetCameraSelection();
                setInputMode('image');
                cameraStatus.textContent = '尚未啟動鏡頭。';
                setCameraPlaceholder();
                setParseStatus('無法啟動鏡頭，請確認已授權權限，且瀏覽器環境允許使用攝影機。', 'error');
            }
        }

        async function switchTab(tabName) {
            const panels = {
                generator: generatorPanel,
                parser: parserPanel
            };

            if (!panels[tabName]) {
                return;
            }

            if (tabName !== 'parser') {
                await stopCameraScan({ silent: true });
            }

            tabButtons.forEach((button) => {
                const isActive = button.dataset.tab === tabName;
                button.classList.toggle('is-active', isActive);
                button.setAttribute('aria-selected', String(isActive));
            });

            Object.entries(panels).forEach(([name, panel]) => {
                const isActive = name === tabName;
                panel.hidden = !isActive;
                panel.classList.toggle('is-active', isActive);
            });
        }

        generateBtn.addEventListener('click', generateQRCode);
        clearBtn.addEventListener('click', clearGenerator);
        copyResultBtn.addEventListener('click', copyDecodedResult);

        textInput.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                generateQRCode();
            }
        });

        tabButtons.forEach((button) => {
            button.addEventListener('click', () => {
                void switchTab(button.dataset.tab);
            });
        });

        pickImageBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            imageInput.click();
        });

        cameraSelect.addEventListener('change', () => {
            void restartCameraScan(cameraSelect.value);
        });

        imageInput.addEventListener('change', async (event) => {
            const file = getImageFile(event.target.files || []);

            if (file) {
                await decodeImageFile(file, '選取圖片');
            }

            imageInput.value = '';
        });

        dropZone.addEventListener('dragenter', (event) => {
            event.preventDefault();
            dropZone.classList.add('is-dragging');
        });

        dropZone.addEventListener('dragover', (event) => {
            event.preventDefault();
            dropZone.classList.add('is-dragging');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('is-dragging');
        });

        dropZone.addEventListener('drop', async (event) => {
            event.preventDefault();
            dropZone.classList.remove('is-dragging');

            const file = getImageFile(event.dataTransfer?.files || []);

            if (!file) {
                setParseStatus('拖入的內容不是圖片檔案，請改放入 PNG、JPG、WEBP 等圖片。', 'error');
                return;
            }

            await decodeImageFile(file, '拖曳圖片');
        });

        cameraReader.addEventListener('wheel', handleCameraWheelZoom, { passive: false });
        cameraReader.addEventListener('pointerdown', handleCameraPointerDown);
        cameraReader.addEventListener('pointermove', handleCameraPointerMove);
        cameraReader.addEventListener('pointerup', handleCameraPointerEnd);
        cameraReader.addEventListener('pointercancel', handleCameraPointerEnd);
        cameraReader.addEventListener('pointerleave', handleCameraPointerEnd);
        cameraReader.addEventListener('gesturestart', handleCameraGestureStart, { passive: false });
        cameraReader.addEventListener('gesturechange', handleCameraGestureChange, { passive: false });
        cameraReader.addEventListener('gestureend', handleCameraGestureEnd, { passive: false });
        cameraReader.addEventListener('touchmove', handleCameraTouchMove, { passive: false });

        document.addEventListener('paste', (event) => {
            if (parserPanel.hidden) {
                return;
            }

            const items = [...(event.clipboardData?.items || [])];
            const imageItem = items.find((item) => item.type.startsWith('image/'));

            if (!imageItem) {
                return;
            }

            event.preventDefault();
            const file = imageItem.getAsFile();

            if (file) {
                void decodeImageFile(file, '剪貼簿圖片');
            }
        });

        startCameraBtn.addEventListener('click', () => {
            void startCameraScan();
        });

        stopCameraBtn.addEventListener('click', () => {
            void stopCameraScan();
        });

        if (!Html5QrcodeLib) {
            setParseStatus('html5-qrcode 函式庫未載入，解析功能目前不可用。', 'error');
            pickImageBtn.disabled = true;
            startCameraBtn.disabled = true;
        }

        setInputMode('image');
        resetCameraSelection();
        resetResult();
        clearGenerator();