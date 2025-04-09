/**
 * Основной файл JavaScript приложения ITRemote
 * 
 * Отвечает за:
 * - Инициализацию всех сервисов
 * - Обработку пользовательского интерфейса
 * - Связывание компонентов между собой
 * 
 * Схема работы приложения:
 * 1. Пользователь выбирает роль (сервер или клиент) и вводит код подключения
 * 2. При подключении в режиме сервера запускается захват экрана через ScreenCapture
 * 3. При подключении в режиме клиента устанавливается соединение с транслирующей стороной
 * 4. WebRTC используется для прямой передачи видео между пользователями
 * 5. Firebase используется для сигналинга и первоначального соединения
 */
document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // Инициализация сервисов и переменных
    // ==========================================
    
    // Инициализация логирования
    const logger = new Logger('App');
    logger.log('Приложение запущено');

    // Инициализация основных сервисов
    const firebaseService = new FirebaseService();                    // Сервис для работы с Firebase
    const webRTCService = new WebRTCService();                        // Сервис для работы с WebRTC
    const screenCapture = new ScreenCapture(firebaseService, webRTCService); // Сервис захвата экрана

    // Состояние приложения
    let isConnected = false;     // Флаг состояния подключения
    let currentMode = '';        // Текущий режим (broadcast/control)
    let isConnecting = false;    // Флаг процесса подключения
    let reconnectAttempts = 0;   // Счетчик попыток переподключения
    let maxReconnectAttempts = 5;// Максимальное количество попыток
    let reconnectInterval = null;// Интервал для переподключения
    let sessionStartTime = null; // Время начала сессии
    let sessionDuration = null;  // Интервал обновления времени сессии
    let connectionCode = '';     // Текущий код подключения

    // ==========================================
    // Получение элементов пользовательского интерфейса
    // ==========================================
    
    // Элементы подключения и выбора роли
    const connectionCodeInput = document.getElementById('connectionCode');
    const roleRadioBroadcast = document.getElementById('broadcast-role');
    const roleRadioControl = document.getElementById('control-role');
    const connectButton = document.getElementById('connectButton');
    const disconnectButton = document.getElementById('disconnectButton');
    const generateCodeBtn = document.getElementById('generateCodeBtn');
    const roleIndicator = document.getElementById('role-indicator');
    
    // Элементы настроек качества и FPS
    const qualitySlider = document.getElementById('quality');
    const qualityValue = document.getElementById('qualityValue');
    const fpsSelect = document.getElementById('fps');
    const resolutionSelect = document.getElementById('resolution');
    
    // Элементы статуса и отображения
    const connectionStatus = document.getElementById('connectionStatus');
    const currentFpsElement = document.getElementById('currentFps');
    const sessionTimeElement = document.getElementById('sessionTime');
    const clientCountElement = document.getElementById('clientCount');
    const clientInfoBlock = document.getElementById('clientInfo');
    const remoteScreen = document.getElementById('remoteScreen');
    const remoteVideo = document.getElementById('remoteVideo');
    const loadingScreen = document.getElementById('loadingScreen');
    const controlHelpOverlay = document.getElementById('controlHelpOverlay');
    const keyboardToggleBtn = document.getElementById('keyboardToggleBtn');
    
    // Элементы переподключения
    const reconnectInfo = document.getElementById('reconnectInfo');
    const reconnectProgressBar = document.getElementById('reconnectProgressBar');
    const cancelReconnectBtn = document.getElementById('cancelReconnectBtn');
    const reconnectModal = new bootstrap.Modal(document.getElementById('reconnectModal'));
    const tryReconnectBtn = document.getElementById('tryReconnectBtn');

    // ==========================================
    // Проверка поддержки браузера
    // ==========================================
    
    // Проверяем поддержку WebRTC и других необходимых API
    function checkBrowserSupport() {
        // Проверка поддержки WebRTC
        const hasWebRTC = !!(window.RTCPeerConnection);
        
        // Проверка поддержки захвата экрана
        const hasScreenCapture = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
        
        // Проверка поддержки Canvas
        const hasCanvas = !!(document.createElement('canvas').getContext);
        
        return {
            hasWebRTC,
            hasScreenCapture,
            hasCanvas,
            hasAllRequired: hasWebRTC && hasScreenCapture && hasCanvas
        };
    }
    
    // Проверяем поддержку браузера
    const browserSupport = checkBrowserSupport();
    
    if (!browserSupport.hasAllRequired) {
        // Показываем сообщение об ошибке
        logger.error('Ваш браузер не поддерживает необходимые технологии');
        
        loadingScreen.style.display = 'flex';
        let errorMessage = 'Ваш браузер не поддерживает следующие технологии:';
        
        if (!browserSupport.hasWebRTC) errorMessage += ' WebRTC,';
        if (!browserSupport.hasScreenCapture) errorMessage += ' захват экрана,';
        if (!browserSupport.hasCanvas) errorMessage += ' Canvas,';
        
        // Удаляем последнюю запятую и добавляем рекомендацию
        errorMessage = errorMessage.replace(/,$/, '');
        errorMessage += '. Рекомендуем использовать Chrome, Firefox или Edge последних версий.';
        
        loadingScreen.querySelector('p').textContent = errorMessage;
        connectButton.disabled = true;
        return;
    }

    // ==========================================
    // Настройка обработчиков событий для элементов управления
    // ==========================================
    
    // Обработчик изменения качества
    qualitySlider.addEventListener('input', () => {
        const quality = qualitySlider.value;
        qualityValue.textContent = quality;
        screenCapture.setCompressionQuality(quality);
    });

    // Обработчик изменения FPS
    fpsSelect.addEventListener('change', () => {
        const fps = parseInt(fpsSelect.value);
        const intervalMs = Math.round(1000 / fps);
        screenCapture.setCaptureInterval(intervalMs);
        logger.log(`FPS установлен на ${fps}, интервал: ${intervalMs} мс`);
    });

    // Обработчик изменения разрешения
    resolutionSelect.addEventListener('change', () => {
        const [width, height] = resolutionSelect.value.split('x').map(Number);
        screenCapture.setResolution(width, height);
        logger.log(`Разрешение установлено на ${width}x${height}`);
    });

    // Обработчик нажатия кнопки генерации кода
    generateCodeBtn.addEventListener('click', () => {
        connectionCodeInput.value = webRTCService.generateConnectionCode();
    });

    // Обработчик изменения роли
    roleRadioBroadcast.addEventListener('change', updateRoleUI);
    roleRadioControl.addEventListener('change', updateRoleUI);

    // Обработчик отмены переподключения
    cancelReconnectBtn.addEventListener('click', () => {
        stopReconnection();
        showError('Попытка переподключения отменена пользователем');
    });

    // Обработчик кнопки попытки переподключения в модальном окне
    tryReconnectBtn.addEventListener('click', () => {
        reconnectModal.hide();
        startReconnection();
    });
    
    // Обработчик кнопки вызова клавиатуры (для мобильных)
    keyboardToggleBtn.addEventListener('click', () => {
        // Здесь будет логика для мобильных устройств
        logger.log('Нажата кнопка вызова клавиатуры');
    });

    // ==========================================
    // Настройка обработчиков WebRTC событий
    // ==========================================
    
    // Обработчик установления WebRTC соединения
    document.addEventListener('webrtc-connected', () => {
        logger.success('WebRTC соединение установлено');
        loadingScreen.style.display = 'none';
        isConnected = true;
        isConnecting = false;
        
        // Обновляем статус подключения
        updateConnectionStatus('online');
        
        // Сбрасываем счетчик попыток переподключения
        reconnectAttempts = 0;
        
        // Запускаем таймер сессии
        startSessionTimer();
        
        // Показываем панель помощи по управлению, если это режим клиента
        if (currentMode === 'control') {
            controlHelpOverlay.classList.remove('d-none');
            
            // Фокусировка на canvas для получения событий клавиатуры
            remoteScreen.tabIndex = 1;
            remoteScreen.focus();
            
            // Показываем кнопку клавиатуры на мобильных устройствах
            if (isMobileDevice()) {
                keyboardToggleBtn.classList.remove('d-none');
            }
        }
        
        updateUI();
    });
    
    // Обработчик разрыва WebRTC соединения
    document.addEventListener('webrtc-disconnected', (event) => {
        logger.warn(`WebRTC соединение разорвано: ${event.detail?.state || 'неизвестная причина'}`);
        
        // Если соединение было установлено и разорвалось, показываем модальное окно
        if (isConnected) {
            stopSessionTimer();
            isConnected = false;
            
            // Если мы в режиме клиента, пытаемся переподключиться
            if (currentMode === 'control') {
                showReconnectModal();
            } else {
                // Если это сервер, просто сообщаем о разрыве соединения
                logger.warn('Клиент отключился от трансляции');
                updateUI();
            }
        } else {
            updateUI();
        }
    });

    // Обработчик подключения клиента (только для режима сервера)
    document.addEventListener('client-connected', (event) => {
        const clientId = event.detail?.clientId || 'неизвестный';
        logger.success(`Подключился новый клиент: ${clientId}`);
        
        // Обновляем счетчик клиентов
        updateClientCount(1);
    });
    
    // Обработчик отключения клиента (только для режима сервера)
    document.addEventListener('client-disconnected', (event) => {
        const clientId = event.detail?.clientId || 'неизвестный';
        logger.warn(`Клиент отключился: ${clientId}`);
        
        // Обновляем счетчик клиентов
        updateClientCount(-1);
    });

    // ==========================================
    // Обработчики событий управления (клиент)
    // ==========================================
    
    // Обработчик нажатия мыши на удаленном экране
    remoteScreen.addEventListener('mousedown', (event) => {
        if (!isConnected || currentMode !== 'control') return;
        
        // Получаем координаты относительно экрана
        const bounds = remoteScreen.getBoundingClientRect();
        const scaleX = remoteScreen.width / bounds.width;
        const scaleY = remoteScreen.height / bounds.height;
        
        const x = Math.round((event.clientX - bounds.left) * scaleX);
        const y = Math.round((event.clientY - bounds.top) * scaleY);
        
        // Определяем тип кнопки мыши
        const button = event.button; // 0 - ЛКМ, 1 - СКМ, 2 - ПКМ
        
        // Отправляем команду на сервер
        sendMouseEvent('mousedown', x, y, button);
        
        // Предотвращаем стандартное контекстное меню при ПКМ
        if (button === 2) {
            event.preventDefault();
        }
    });
    
    // Обработчик отпускания кнопки мыши
    remoteScreen.addEventListener('mouseup', (event) => {
        if (!isConnected || currentMode !== 'control') return;
        
        const bounds = remoteScreen.getBoundingClientRect();
        const scaleX = remoteScreen.width / bounds.width;
        const scaleY = remoteScreen.height / bounds.height;
        
        const x = Math.round((event.clientX - bounds.left) * scaleX);
        const y = Math.round((event.clientY - bounds.top) * scaleY);
        const button = event.button;
        
        sendMouseEvent('mouseup', x, y, button);
    });
    
    // Обработчик движения мыши
    remoteScreen.addEventListener('mousemove', (event) => {
        if (!isConnected || currentMode !== 'control') return;
        
        const bounds = remoteScreen.getBoundingClientRect();
        const scaleX = remoteScreen.width / bounds.width;
        const scaleY = remoteScreen.height / bounds.height;
        
        const x = Math.round((event.clientX - bounds.left) * scaleX);
        const y = Math.round((event.clientY - bounds.top) * scaleY);
        
        sendMouseEvent('mousemove', x, y);
    });
    
    // Обработчик скролла
    remoteScreen.addEventListener('wheel', (event) => {
        if (!isConnected || currentMode !== 'control') return;
        
        const deltaX = event.deltaX;
        const deltaY = event.deltaY;
        
        sendScrollEvent(deltaX, deltaY);
        event.preventDefault();
    });
    
    // Отключаем контекстное меню браузера на canvas
    remoteScreen.addEventListener('contextmenu', (event) => {
        if (currentMode === 'control') {
            event.preventDefault();
        }
    });
    
    // Обработчик событий клавиатуры
    document.addEventListener('keydown', (event) => {
        if (!isConnected || currentMode !== 'control') return;
        
        // Проверка, что фокус не на поле ввода
        if (document.activeElement.tagName === 'INPUT' || 
            document.activeElement.tagName === 'TEXTAREA') {
            return;
        }
        
        const keyCode = event.keyCode;
        const key = event.key;
        
        sendKeyEvent('keydown', keyCode, key);
        
        // Предотвращаем стандартную обработку некоторых клавиш
        // для системных комбинаций (Ctrl+R, F5, Alt+Tab и т.д.)
        if (event.ctrlKey || event.altKey || 
            (keyCode >= 112 && keyCode <= 123)) { // F1-F12
            event.preventDefault();
        }
    });
    
    document.addEventListener('keyup', (event) => {
        if (!isConnected || currentMode !== 'control') return;
        
        if (document.activeElement.tagName === 'INPUT' || 
            document.activeElement.tagName === 'TEXTAREA') {
            return;
        }
        
        const keyCode = event.keyCode;
        const key = event.key;
        
        sendKeyEvent('keyup', keyCode, key);
        
        // Предотвращаем стандартную обработку некоторых клавиш
        if (event.ctrlKey || event.altKey || 
            (keyCode >= 112 && keyCode <= 123)) { // F1-F12
            event.preventDefault();
        }
    });

    // ==========================================
    // Настройка обработчиков для кнопок подключения
    // ==========================================
    
    // Обработчик нажатия кнопки подключения
    connectButton.addEventListener('click', async () => {
        // Предотвращаем повторное нажатие во время подключения
        if (isConnecting) return;
        
        try {
            // Проверка кода подключения
            connectionCode = connectionCodeInput.value.trim().toUpperCase();
            if (!connectionCode) {
                logger.error('Код подключения не может быть пустым');
                return;
            }
            
            // Устанавливаем флаг подключения и обновляем UI
            isConnecting = true;
            updateConnectionStatus('connecting');
            updateUI();

            // Сохраняем текущий режим
            currentMode = roleRadioBroadcast.checked ? 'broadcast' : 'control';
            
            // Применяем все настройки к сервису захвата экрана
            applyCurrentSettings(connectionCode);
            
            // Показываем экран загрузки
            loadingScreen.style.display = 'flex';
            loadingScreen.querySelector('p').textContent = 'Ожидание подключения...';
            
            // В зависимости от режима запускаем трансляцию или мониторинг
            if (currentMode === 'broadcast') {
                // Режим трансляции экрана (сервер)
                await screenCapture.startCapturing();
                
                // Обновляем UI для роли сервера
                updateRoleIndicator('server');
                clientInfoBlock.classList.remove('d-none');
                
                logger.success(`Начата трансляция экрана с кодом: ${connectionCode}`);
            } else {
                // Режим просмотра/управления (клиент)
                await screenCapture.startRemoteScreenMonitoring();
                
                // Обновляем UI для роли клиента
                updateRoleIndicator('client');
                
                logger.success(`Подключено к трансляции с кодом: ${connectionCode}`);
            }
            
        } catch (error) {
            logger.error(`Ошибка при подключении: ${error.message}`);
            loadingScreen.style.display = 'none';
            isConnected = false;
            
            // Показываем сообщение об ошибке в интерфейсе
            if (error.name === 'NotAllowedError') {
                // Пользователь отклонил доступ к экрану
                showError('Доступ к экрану отклонен пользователем');
            } else if (error.message.includes('Не удалось найти трансляцию')) {
                showError('Трансляция не найдена');
            } else {
                showError(`Ошибка: ${error.message}`);
            }
        } finally {
            isConnecting = false;
            updateUI();
        }
    });

    // Обработчик нажатия кнопки отключения
    disconnectButton.addEventListener('click', () => {
        try {
            // Останавливаем таймер сессии
            stopSessionTimer();
            
            // В зависимости от режима останавливаем трансляцию или мониторинг
            if (currentMode === 'broadcast') {
                screenCapture.stopCapturing();
                clientInfoBlock.classList.add('d-none');
                logger.log('Трансляция экрана остановлена');
            } else {
                screenCapture.stopRemoteScreenMonitoring();
                // Скрываем панель управления
                controlHelpOverlay.classList.add('d-none');
                keyboardToggleBtn.classList.add('d-none');
                logger.log('Отключено от трансляции');
            }
            
            // Очищаем элементы отображения
            clearDisplayElements();
            
            // Обновляем состояние и интерфейс
            isConnected = false;
            updateRoleIndicator('none');
            updateConnectionStatus('offline');
            updateUI();
            
        } catch (error) {
            logger.error(`Ошибка при отключении: ${error.message}`);
        }
    });

    // ==========================================
    // Функции для отправки команд управления
    // ==========================================
    
    /**
     * Отправляет событие мыши на сервер
     * @param {string} eventType Тип события (mousedown, mouseup, mousemove)
     * @param {number} x Координата X
     * @param {number} y Координата Y
     * @param {number} button Кнопка мыши (0-ЛКМ, 1-СКМ, 2-ПКМ)
     */
    function sendMouseEvent(eventType, x, y, button = 0) {
        if (!isConnected || currentMode !== 'control') return;
        
        try {
            const command = {
                type: 'mouse',
                action: eventType,
                x: x,
                y: y,
                button: button
            };
            
            // Отправляем команду через WebRTC, если доступно
            if (webRTCService.sendMessage(command)) {
                logger.log(`Отправлена команда мыши: ${eventType} на (${x}, ${y}), кнопка ${button}`);
                return;
            }
            
            // Резервный вариант - отправка через Firebase
            firebaseService.sendControlCommand(connectionCode, command);
        } catch (error) {
            logger.error(`Ошибка отправки команды мыши: ${error.message}`);
        }
    }
    
    /**
     * Отправляет событие прокрутки колеса мыши
     * @param {number} deltaX Горизонтальная прокрутка
     * @param {number} deltaY Вертикальная прокрутка
     */
    function sendScrollEvent(deltaX, deltaY) {
        if (!isConnected || currentMode !== 'control') return;
        
        try {
            const command = {
                type: 'scroll',
                deltaX: deltaX,
                deltaY: deltaY
            };
            
            // Отправляем команду через WebRTC, если доступно
            if (webRTCService.sendMessage(command)) {
                logger.log(`Отправлена команда прокрутки: deltaX=${deltaX}, deltaY=${deltaY}`);
                return;
            }
            
            // Резервный вариант - отправка через Firebase
            firebaseService.sendControlCommand(connectionCode, command);
        } catch (error) {
            logger.error(`Ошибка отправки команды прокрутки: ${error.message}`);
        }
    }
    
    /**
     * Отправляет событие клавиатуры
     * @param {string} eventType Тип события (keydown, keyup)
     * @param {number} keyCode Код клавиши
     * @param {string} key Символ клавиши
     */
    function sendKeyEvent(eventType, keyCode, key) {
        if (!isConnected || currentMode !== 'control') return;
        
        try {
            const command = {
                type: 'keyboard',
                action: eventType,
                keyCode: keyCode,
                key: key
            };
            
            // Отправляем команду через WebRTC, если доступно
            if (webRTCService.sendMessage(command)) {
                logger.log(`Отправлена команда клавиатуры: ${eventType}, key=${key}, code=${keyCode}`);
                return;
            }
            
            // Резервный вариант - отправка через Firebase
            firebaseService.sendControlCommand(connectionCode, command);
        } catch (error) {
            logger.error(`Ошибка отправки команды клавиатуры: ${error.message}`);
        }
    }

    // ==========================================
    // Функции для управления переподключением
    // ==========================================
    
    /**
     * Показывает модальное окно переподключения
     */
    function showReconnectModal() {
        reconnectModal.show();
    }
    
    /**
     * Запускает процесс автоматического переподключения
     */
    function startReconnection() {
        // Сбрасываем счетчик попыток
        reconnectAttempts = 0;
        
        // Показываем индикатор переподключения
        reconnectInfo.classList.remove('d-none');
        
        // Запускаем процесс переподключения
        attemptReconnect();
    }
    
    /**
     * Останавливает процесс переподключения
     */
    function stopReconnection() {
        if (reconnectInterval) {
            clearTimeout(reconnectInterval);
            reconnectInterval = null;
        }
        
        reconnectInfo.classList.add('d-none');
        reconnectProgressBar.style.width = '0%';
        reconnectAttempts = 0;
    }
    
    /**
     * Выполняет одну попытку переподключения
     */
    async function attemptReconnect() {
        reconnectAttempts++;
        
        // Обновляем прогресс-бар
        const progress = (reconnectAttempts / maxReconnectAttempts) * 100;
        reconnectProgressBar.style.width = `${progress}%`;
        
        logger.log(`Попытка переподключения ${reconnectAttempts} из ${maxReconnectAttempts}...`);
        
        try {
            // Применяем настройки и пробуем переподключиться
            applyCurrentSettings(connectionCode);
            
            if (currentMode === 'broadcast') {
                await screenCapture.startCapturing();
            } else {
                await screenCapture.startRemoteScreenMonitoring();
            }
            
            // Если успешно переподключились
            logger.success('Переподключение выполнено успешно');
            stopReconnection();
            reconnectInfo.classList.add('d-none');
            
        } catch (error) {
            logger.error(`Ошибка при переподключении: ${error.message}`);
            
            // Если достигли максимального количества попыток
            if (reconnectAttempts >= maxReconnectAttempts) {
                logger.error('Достигнуто максимальное количество попыток переподключения');
                stopReconnection();
                showError('Не удалось переподключиться после нескольких попыток');
                return;
            }
            
            // Планируем следующую попытку через 3 секунды
            reconnectInterval = setTimeout(attemptReconnect, 3000);
        }
    }

    // ==========================================
    // Вспомогательные функции
    // ==========================================
    
    /**
     * Применяет текущие настройки к сервису захвата экрана
     * @param {string} connectionCode Код подключения
     */
    function applyCurrentSettings(code) {
        // Устанавливаем код подключения
        screenCapture.setConnectionCode(code);
        
        // Устанавливаем качество сжатия
        screenCapture.setCompressionQuality(parseInt(qualitySlider.value));
        
        // Устанавливаем FPS
        const fps = parseInt(fpsSelect.value);
        const intervalMs = Math.round(1000 / fps);
        screenCapture.setCaptureInterval(intervalMs);
        
        // Устанавливаем разрешение
        const [width, height] = resolutionSelect.value.split('x').map(Number);
        screenCapture.setResolution(width, height);
    }
    
    /**
     * Очищает элементы отображения удаленного экрана
     */
    function clearDisplayElements() {
        // Очищаем canvas
        if (remoteScreen) {
            const context = remoteScreen.getContext('2d');
            context.clearRect(0, 0, remoteScreen.width, remoteScreen.height);
        }
        
        // Очищаем видео
        if (remoteVideo && remoteVideo.srcObject) {
            const tracks = remoteVideo.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }
    }
    
    /**
     * Обновляет состояние пользовательского интерфейса
     * в зависимости от статуса подключения
     */
    function updateUI() {
        // Управление кнопками
        connectButton.disabled = isConnected || isConnecting;
        disconnectButton.disabled = !isConnected;
        
        // Управление полями ввода
        connectionCodeInput.disabled = isConnected || isConnecting;
        
        // Управление переключателями ролей
        roleRadioBroadcast.disabled = isConnected || isConnecting;
        roleRadioControl.disabled = isConnected || isConnecting;
        
        // Управление элементами настроек
        const settingsDisabled = isConnected || isConnecting;
        qualitySlider.disabled = settingsDisabled;
        fpsSelect.disabled = settingsDisabled;
        resolutionSelect.disabled = settingsDisabled;
        
        // Обновление статуса в интерфейсе
        if (!isConnected && !isConnecting) {
            updateConnectionStatus('offline');
            currentFpsElement.textContent = '0';
            sessionTimeElement.textContent = '00:00:00';
        }
    }
    
    /**
     * Обновляет UI для выбранной роли
     */
    function updateRoleUI() {
        const selectedRole = roleRadioBroadcast.checked ? 'broadcast' : 'control';
        
        if (selectedRole === 'broadcast') {
            // Настройка UI для роли сервера
            roleIndicator.querySelector('.badge').textContent = 'Режим: Сервер';
            loadingScreen.querySelector('p').textContent = 'Ожидание клиентов...';
        } else {
            // Настройка UI для роли клиента
            roleIndicator.querySelector('.badge').textContent = 'Режим: Клиент';
            loadingScreen.querySelector('p').textContent = 'Подключение к серверу...';
        }
    }
    
    /**
     * Обновляет индикатор роли в верхней части экрана
     * @param {string} role Роль (server/client/none)
     */
    function updateRoleIndicator(role) {
        const badge = roleIndicator.querySelector('.badge');
        
        if (role === 'server') {
            badge.className = 'badge bg-success';
            badge.textContent = 'Сервер: Трансляция экрана';
            document.body.classList.add('active-broadcast');
        } else if (role === 'client') {
            badge.className = 'badge bg-primary';
            badge.textContent = 'Клиент: Управление';
        } else {
            badge.className = 'badge bg-secondary';
            badge.textContent = 'Не подключено';
            document.body.classList.remove('active-broadcast');
        }
    }
    
    /**
     * Обновляет индикатор статуса подключения
     * @param {string} status Статус (online/offline/connecting)
     */
    function updateConnectionStatus(status) {
        connectionStatus.className = 'status-badge';
        
        if (status === 'online') {
            connectionStatus.classList.add('online');
            connectionStatus.textContent = 'Подключено';
        } else if (status === 'connecting') {
            connectionStatus.classList.add('connecting');
            connectionStatus.textContent = 'Подключение...';
        } else {
            connectionStatus.classList.add('offline');
            connectionStatus.textContent = 'Отключено';
        }
    }
    
    /**
     * Показывает сообщение об ошибке в интерфейсе
     * @param {string} message Сообщение об ошибке
     */
    function showError(message) {
        logger.error(message);
        updateConnectionStatus('offline');
        
        // Можно добавить всплывающее уведомление или другой способ
        // отображения ошибки в интерфейсе
    }
    
    /**
     * Запускает таймер сессии
     */
    function startSessionTimer() {
        sessionStartTime = new Date();
        
        // Обновляем таймер каждую секунду
        sessionDuration = setInterval(() => {
            if (!sessionStartTime) return;
            
            const now = new Date();
            const diff = now - sessionStartTime;
            
            // Форматируем время в ч:м:с
            const hours = Math.floor(diff / 3600000).toString().padStart(2, '0');
            const minutes = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
            const seconds = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
            
            sessionTimeElement.textContent = `${hours}:${minutes}:${seconds}`;
        }, 1000);
    }
    
    /**
     * Останавливает таймер сессии
     */
    function stopSessionTimer() {
        if (sessionDuration) {
            clearInterval(sessionDuration);
            sessionDuration = null;
        }
        sessionStartTime = null;
        sessionTimeElement.textContent = '00:00:00';
    }
    
    /**
     * Обновляет счетчик подключенных клиентов
     * @param {number} change Изменение счетчика (+1 или -1)
     */
    function updateClientCount(change) {
        if (!clientCountElement) return;
        
        const currentCount = parseInt(clientCountElement.textContent) || 0;
        const newCount = Math.max(0, currentCount + change);
        
        clientCountElement.textContent = newCount;
    }
    
    /**
     * Проверяет, является ли устройство мобильным
     * @returns {boolean} true, если устройство мобильное
     */
    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // ==========================================
    // Инициализация при запуске
    // ==========================================
    
    // Генерация случайного кода подключения при загрузке
    try {
        if (connectionCodeInput) {
            connectionCodeInput.value = webRTCService.generateConnectionCode();
        }
    } catch (error) {
        logger.error(`Ошибка при генерации кода подключения: ${error.message}`);
    }

    // Добавляем обработчик обновления FPS
    screenCapture.addFpsUpdatedListener((fps) => {
        if (currentFpsElement && isConnected) {
            currentFpsElement.textContent = fps;
        }
    });
    
    // Инициализируем UI
    updateRoleUI();
    updateUI();
    
    // Добавляем элемент для логов
    logger.log('Система готова к работе');

    // ==========================================
    // Обработчики для WebRTC и канала данных
    // ==========================================
    
    // Обработчик открытия канала данных
    document.addEventListener('datachannel-open', () => {
        logger.success('Канал данных WebRTC открыт');
        
        // В режиме управления можно отправить тестовую команду
        if (currentMode === 'control' && isConnected) {
            // Отправляем тестовую команду для проверки канала
            const testCommand = {
                type: 'test',
                message: 'Проверка канала управления'
            };
            
            if (webRTCService.sendMessage(testCommand)) {
                logger.log('Тестовая команда отправлена успешно');
            }
        }
    });
    
    // Обработчик закрытия канала данных
    document.addEventListener('datachannel-close', () => {
        logger.warn('Канал данных WebRTC закрыт');
    });
    
    // Обработчик ошибки канала данных
    document.addEventListener('datachannel-error', (event) => {
        logger.error(`Ошибка канала данных: ${event.detail?.error || 'неизвестная ошибка'}`);
    });
    
    // Обработчик сообщений из WebRTC канала данных
    document.addEventListener('webrtc-message', (event) => {
        const message = event.detail;
        
        // Обрабатываем только в соответствующем режиме
        if (currentMode === 'broadcast') {
            logger.log(`Получено сообщение управления: ${message.type}`);
        } else if (currentMode === 'control' && message.type === 'test-response') {
            logger.log(`Получен ответ от сервера: ${message.message}`);
        }
    });
}); 