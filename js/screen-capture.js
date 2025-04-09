/**
 * Класс для захвата и трансляции экрана с использованием WebRTC
 * 
 * Отвечает за:
 * - Захват экрана пользователя
 * - Подготовку видеопотока для WebRTC
 * - Мониторинг удаленного экрана
 * - Управление качеством и FPS
 * 
 * Связи с другими компонентами:
 * - Использует FirebaseService для работы с Firebase
 * - Использует WebRTCService для передачи видеопотока
 * - Генерирует события, которые обрабатываются в app.js
 */
class ScreenCapture {
    /**
     * Инициализирует компонент захвата экрана
     * 
     * @param {FirebaseService} firebaseService Сервис для работы с Firebase
     * @param {WebRTCService} webRTCService Сервис для работы с WebRTC
     */
    constructor(firebaseService, webRTCService) {
        // Внешние сервисы, используемые для передачи данных
        this.firebaseService = firebaseService;  // Для передачи через Firebase
        this.webRTCService = webRTCService;      // Для передачи через WebRTC
        
        // Параметры подключения и захвата
        this.connectionCode = '';                // Код подключения
        this.captureInterval = 66;               // 15 FPS по умолчанию
        this.compressionQuality = 80;            // Качество сжатия JPEG (1-100)
        this.resolution = { width: 1280, height: 720 }; // Разрешение HD по умолчанию
        
        // Флаги состояния
        this.isCapturing = false;                // Флаг активного захвата
        this.isMonitoring = false;               // Флаг активного мониторинга
        
        // Технические переменные для оптимизации
        this.lastImageHash = '';                 // Хеш последнего изображения (для обнаружения изменений)
        this.frameCount = 0;                     // Счетчик обработанных кадров
        this.lastFpsCalcTime = Date.now();       // Время последнего расчета FPS
        this.currentFps = 0;                     // Текущий FPS
        this.fpsListeners = [];                  // Обработчики событий обновления FPS
        this.useResolutionScaling = true;        // Флаг использования масштабирования
        
        // Переменные для отслеживания мыши и кликов
        this._lastMouseX = null;                 // Последняя X-координата мыши
        this._lastMouseY = null;                 // Последняя Y-координата мыши
        this._lastMouseButton = null;            // Последняя нажатая кнопка мыши
        this._lastClickTime = 0;                 // Время последнего клика
        this._clickCount = 0;                    // Счетчик кликов (для обнаружения двойного клика)
        
        // Объекты для работы с видео и изображениями
        this.localStream = null;                 // Локальный поток устройства
        this.videoElement = null;                // Элемент для отображения видео
        this.screenCapturedCallbacks = [];       // Обработчики событий захвата экрана
        
        // Элементы для отображения удаленного экрана
        this.remoteCanvas = document.getElementById('remoteScreen');
        this.remoteVideo = document.getElementById('remoteVideo');
        
        if (this.remoteCanvas) {
            this.remoteContext = this.remoteCanvas.getContext('2d');
        }
        
        // Инициализация логгера
        this.logger = new Logger('ScreenCapture');
        
        // Настраиваем обработчики событий WebRTC
        this._setupWebRTCEventHandlers();
    }
    
    /**
     * Настраивает обработчики событий WebRTC
     * Приватный метод, вызывается из конструктора
     */
    _setupWebRTCEventHandlers() {
        // Обработка получения удаленного потока
        document.addEventListener('webrtc-stream', (event) => {
            this.handleRemoteStream(event.detail);
        });
        
        // Обработка установления соединения
        document.addEventListener('webrtc-connected', () => {
            this.logger.success('WebRTC соединение установлено');
        });
        
        // Обработка разрыва соединения
        document.addEventListener('webrtc-disconnected', (event) => {
            this.logger.warn(`WebRTC соединение разорвано: ${event.detail.state}`);
        });
        
        // Обработка команд управления (в режиме сервера)
        document.addEventListener('webrtc-message', (event) => {
            if (this.isCapturing) {
                this.processControlCommand(event.detail);
            }
        });
    }

    /**
     * Устанавливает код подключения
     * @param {string} code Код подключения
     */
    setConnectionCode(code) {
        this.connectionCode = code;
    }

    /**
     * Устанавливает интервал захвата
     * @param {number} intervalMs Интервал в миллисекундах
     */
    setCaptureInterval(intervalMs) {
        this.captureInterval = Math.max(16, Math.min(1000, intervalMs));
    }

    /**
     * Устанавливает качество сжатия
     * @param {number} quality Качество (1-100)
     */
    setCompressionQuality(quality) {
        this.compressionQuality = Math.max(1, Math.min(100, quality));
    }

    /**
     * Устанавливает разрешение
     * @param {number} width Ширина
     * @param {number} height Высота
     */
    setResolution(width, height) {
        this.resolution = { width, height };
    }

    /**
     * Устанавливает использование масштабирования
     * @param {boolean} useScaling Использовать масштабирование
     */
    setUseResolutionScaling(useScaling) {
        this.useResolutionScaling = useScaling;
    }

    /**
     * Добавляет обработчик события захвата экрана
     * @param {Function} callback Функция обратного вызова
     */
    addScreenCapturedListener(callback) {
        this.screenCapturedCallbacks.push(callback);
    }

    /**
     * Добавляет обработчик события обновления FPS
     * @param {Function} callback Функция обратного вызова
     */
    addFpsUpdatedListener(callback) {
        this.fpsListeners.push(callback);
    }

    /**
     * Запускает захват экрана и трансляцию через WebRTC
     * @throws {Error} Если код подключения не установлен или возникла ошибка при захвате экрана
     */
    async startCapturing() {
        if (this.isCapturing) {
            return;
        }

        this.isCapturing = true;
        this.frameCount = 0;
        this.lastFpsCalcTime = Date.now();
        this.currentFps = 0;
        this.lastImageHash = '';

        if (!this.connectionCode) {
            this.isCapturing = false;
            this.logger.error("Код подключения не установлен");
            throw new Error("Код подключения не установлен");
        }
        
        try {
            // Регистрируем сессию в Firebase перед началом трансляции
            await this.firebaseService.registerSession(this.connectionCode);
            
            // Проверяем инициализацию WebRTC сервиса
            if (!this.webRTCService) {
                throw new Error('WebRTC сервис не инициализирован');
            }
            
            // Инициализируем WebRTC соединение перед запросом доступа к экрану
            await this.webRTCService.initialize(this.connectionCode, true);
            
            // Запрашиваем доступ к экрану
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: this.resolution.width,
                    height: this.resolution.height,
                    frameRate: { ideal: 30 }
                }
            }).catch(error => {
                if (error.name === 'NotAllowedError') {
                    throw new Error('Доступ к экрану отклонен пользователем');
                } else if (error.name === 'AbortError') {
                    throw new Error('Запрос доступа к экрану был отменен');
                } else {
                    throw new Error(`Ошибка при запросе доступа к экрану: ${error.message}`);
                }
            });

            if (!stream || !stream.getVideoTracks().length) {
                throw new Error('Не удалось получить доступ к экрану');
            }

            // Сохраняем поток и передаем его в WebRTC сервис
            this.localStream = stream;
            this.webRTCService.addLocalStream(stream);
            
            // Создаем предложение для потенциальных получателей
            await this.webRTCService.createOffer();

            // Настраиваем обработчик завершения доступа к экрану
            stream.getVideoTracks()[0].onended = () => {
                this.stopCapturing();
                this.logger.warn("Трансляция экрана остановлена пользователем");
            };

            this.logger.success('Начата трансляция экрана');
        } catch (error) {
            this.isCapturing = false;
            
            // Завершаем сессию при ошибке
            if (this.connectionCode) {
                await this.firebaseService.closeSession(this.connectionCode);
            }
            
            this.logger.error(`Ошибка при запуске трансляции: ${error.message}`);
            throw error;
        }
    }

    /**
     * Останавливает захват экрана
     */
    stopCapturing() {
        if (!this.isCapturing) {
            return;
        }

        this.isCapturing = false;
        
        // Закрываем WebRTC соединение
        this.webRTCService.close();
        
        // Завершаем сессию в Firebase
        if (this.connectionCode) {
            this.firebaseService.closeSession(this.connectionCode)
                .catch(error => this.logger.error(`Ошибка при завершении сессии: ${error.message}`));
        }
        
        this.logger.log('Трансляция экрана остановлена');
    }

    /**
     * Запускает мониторинг удаленного экрана через WebRTC
     * @throws {Error} Если код подключения не установлен или возникла другая ошибка
     */
    async startRemoteScreenMonitoring() {
        if (this.isMonitoring) {
            return;
        }

        this.isMonitoring = true;
        this.frameCount = 0;
        this.lastFpsCalcTime = Date.now();
        this.currentFps = 0;

        if (!this.connectionCode) {
            this.isMonitoring = false;
            this.logger.error("Код подключения не установлен");
            throw new Error("Код подключения не установлен");
        }
        
        try {
            // Проверяем наличие активной трансляции перед подключением
            const isSessionActive = await this.checkActiveSession(this.connectionCode);
            
            if (!isSessionActive) {
                this.isMonitoring = false;
                throw new Error("Не удалось найти трансляцию с указанным кодом");
            }
            
            // Инициализируем WebRTC соединение
            await this.webRTCService.initialize(this.connectionCode, false);
            this.logger.success('Начат мониторинг удаленного экрана');
            
            // Устанавливаем таймаут для подключения
            this.connectionTimeout = setTimeout(() => {
                if (!this.webRTCService.isConnected) {
                    this.logger.error("Превышено время ожидания подключения");
                    this.stopRemoteScreenMonitoring();
                    document.dispatchEvent(new CustomEvent('connection-timeout'));
                }
            }, 30000); // 30 секунд на подключение
            
        } catch (error) {
            this.isMonitoring = false;
            this.logger.error(`Ошибка при запуске мониторинга: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Проверяет наличие активной сессии с указанным кодом
     * @param {string} code Код подключения
     * @returns {Promise<boolean>} Результат проверки
     */
    async checkActiveSession(code) {
        try {
            // Проверяем существование сессии с помощью Firebase SDK
            const exists = await this.firebaseService.checkSessionExists(code);
            if (!exists) {
                return false;
            }
            
            // Получаем статус сессии
            const status = await this.firebaseService.getSessionStatus(code);
            return status === 'active';
        } catch (error) {
            this.logger.error(`Ошибка проверки активной сессии: ${error.message}`);
            return false;
        }
    }

    /**
     * Обрабатывает получение удаленного потока
     * @param {MediaStream} stream Медиапоток
     */
    handleRemoteStream(stream) {
        this.logger.success("Получен удаленный поток");
        
        // Скрываем canvas и показываем видео
        if (this.remoteCanvas && this.remoteVideo) {
            this.remoteCanvas.style.display = 'none';
            this.remoteVideo.style.display = 'block';
            
            // Подключаем поток к видеоэлементу
            this.remoteVideo.srcObject = stream;
            
            // Запускаем видео
            this.remoteVideo.play().catch(error => {
                this.logger.error(`Ошибка воспроизведения видео: ${error.message}`);
            });
            
            // Обновляем FPS
            this.startRemoteFpsCounter(stream);
        }
    }
    
    /**
     * Запускает счетчик FPS для удаленного потока
     * @param {MediaStream} stream Медиапоток
     */
    startRemoteFpsCounter(stream) {
        if (!this.isMonitoring) return;
        
        // Обновляем FPS каждую секунду
        this.remoteFpsCounterInterval = setInterval(() => {
            if (stream && stream.getVideoTracks().length > 0) {
                // Для корректного подсчета FPS нужно использовать requestVideoFrameCallback,
                // но это требует поддержки браузера. Пока используем приблизительный метод.
                this.frameCount++;
                const elapsed = (new Date() - this.lastFpsCalcTime) / 1000;
                if (elapsed >= 1) {
                    this.currentFps = Math.round(this.frameCount / elapsed);
                    this.frameCount = 0;
                    this.lastFpsCalcTime = new Date();
                    this.notifyFpsUpdated(this.currentFps);
                }
            }
        }, 1000);
    }

    /**
     * Останавливает мониторинг удаленного экрана
     */
    stopRemoteScreenMonitoring() {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        this.webRTCService.close();
        this.logger.log('Мониторинг удаленного экрана остановлен');
    }

    /**
     * Уведомляет о захвате экрана
     * @param {MediaStream} stream Медиапоток
     */
    notifyScreenCaptured(stream) {
        for (const callback of this.screenCapturedCallbacks) {
            try {
                callback(stream);
            } catch (error) {
                this.logger.error(`Ошибка в обработчике события ScreenCaptured: ${error.message}`);
            }
        }
    }

    /**
     * Уведомляет об обновлении FPS
     * @param {number} fps Текущий FPS
     */
    notifyFpsUpdated(fps) {
        for (const callback of this.fpsListeners) {
            try {
                callback(fps);
            } catch (error) {
                this.logger.error(`Ошибка в обработчике события FpsUpdated: ${error.message}`);
            }
        }
    }

    updateFps() {
        this.frameCount++;
        const now = Date.now();
        const elapsed = (now - this.lastFpsCalcTime) / 1000;

        if (elapsed >= 1) {
            this.currentFps = Math.round(this.frameCount / elapsed);
            this.frameCount = 0;
            this.lastFpsCalcTime = now;

            this.fpsListeners.forEach(listener => listener(this.currentFps));
        }
    }

    calculateImageHash(imageData) {
        let hash = 0;
        const step = 10;
        
        for (let y = 0; y < imageData.height; y += step) {
            for (let x = 0; x < imageData.width; x += step) {
                const i = (y * imageData.width + x) * 4;
                const r = imageData.data[i];
                const g = imageData.data[i + 1];
                const b = imageData.data[i + 2];
                hash = (hash * 31 + (r << 16 | g << 8 | b)) & 0x7FFFFFFF;
            }
        }
        
        return hash.toString();
    }

    /**
     * Обрабатывает полученные команды управления (в режиме сервера)
     * @param {Object} command Команда управления
     */
    processControlCommand(command) {
        if (!command || !command.type) {
            this.logger.error('Получена недопустимая команда');
            return;
        }
        
        this.logger.log(`Получена команда управления: ${command.type}`);
        
        try {
            switch (command.type) {
                case 'mouse':
                    this._processMouseCommand(command);
                    break;
                    
                case 'keyboard':
                    this._processKeyboardCommand(command);
                    break;
                    
                case 'scroll':
                    this._processScrollCommand(command);
                    break;
                    
                default:
                    this.logger.warn(`Неизвестный тип команды: ${command.type}`);
            }
        } catch (error) {
            this.logger.error(`Ошибка обработки команды управления: ${error.message}`);
        }
    }
    
    /**
     * Обрабатывает команды мыши
     * @param {Object} command Команда мыши
     */
    _processMouseCommand(command) {
        if (!command.action || typeof command.x !== 'number' || typeof command.y !== 'number') {
            this.logger.error('Недопустимая команда мыши');
            return;
        }
        
        // Проверяем, что координаты находятся в пределах экрана
        const x = Math.max(0, Math.min(command.x, window.innerWidth));
        const y = Math.max(0, Math.min(command.y, window.innerHeight));
        
        // Создаем объект событие мыши и отправляем его в систему
        const options = {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: command.button || 0,
            buttons: command.button === 0 ? 1 : command.button === 2 ? 2 : 0
        };
        
        // Определяем, какое событие создавать
        let eventType = '';
        switch (command.action) {
            case 'mousedown':
                eventType = 'mousedown';
                
                // Сохраняем последние координаты для обработки клика
                this._lastMouseX = x;
                this._lastMouseY = y;
                this._lastMouseButton = command.button;
                this._lastClickTime = Date.now();
                break;
                
            case 'mouseup':
                eventType = 'mouseup';
                
                // Проверяем, нужно ли симулировать клик (если mousedown и mouseup были рядом)
                const timeSinceMouseDown = Date.now() - (this._lastClickTime || 0);
                const isNearLastPosition = this._lastMouseX && this._lastMouseY &&
                    Math.abs(x - this._lastMouseX) < 5 && 
                    Math.abs(y - this._lastMouseY) < 5;
                
                if (isNearLastPosition && timeSinceMouseDown < 300 && 
                    this._lastMouseButton === command.button) {
                    
                    // Проверяем на двойной клик (два клика в течение 500 мс)
                    const now = Date.now();
                    if (now - this._lastClickTime < 500 && command.button === 0) {
                        this._clickCount++;
                        
                        if (this._clickCount === 2) {
                            // Эмулируем двойной клик
                            this._simulateMouseEvent('dblclick', options);
                            this._clickCount = 0;
                        }
                    } else {
                        this._clickCount = 1;
                    }
                    
                    this._lastClickTime = now;
                    
                    // Если это левая кнопка мыши, имитируем клик после отпускания
                    this._simulateMouseEvent('click', options);
                }
                break;
                
            case 'mousemove':
                eventType = 'mousemove';
                break;
                
            default:
                this.logger.warn(`Неизвестное действие мыши: ${command.action}`);
                return;
        }
        
        this._simulateMouseEvent(eventType, options);
    }
    
    /**
     * Обрабатывает команды клавиатуры
     * @param {Object} command Команда клавиатуры
     */
    _processKeyboardCommand(command) {
        if (!command.action || !command.key) {
            this.logger.error('Недопустимая команда клавиатуры');
            return;
        }
        
        // Создаем объект события клавиатуры
        const options = {
            view: window,
            bubbles: true,
            cancelable: true,
            key: command.key,
            code: command.key,
            keyCode: command.keyCode,
            which: command.keyCode
        };
        
        // Определяем тип события
        const eventType = command.action === 'keydown' ? 'keydown' : 'keyup';
        
        this._simulateKeyboardEvent(eventType, options);
    }
    
    /**
     * Обрабатывает команды прокрутки
     * @param {Object} command Команда прокрутки
     */
    _processScrollCommand(command) {
        if (typeof command.deltaX !== 'number' || typeof command.deltaY !== 'number') {
            this.logger.error('Недопустимая команда прокрутки');
            return;
        }
        
        // Создаем объект события прокрутки
        const options = {
            view: window,
            bubbles: true,
            cancelable: true,
            deltaX: command.deltaX,
            deltaY: command.deltaY,
            deltaMode: 0 // Пиксельный режим
        };
        
        this._simulateWheelEvent(options);
    }
    
    /**
     * Имитирует событие мыши
     * @param {string} eventType Тип события
     * @param {Object} options Параметры события
     */
    _simulateMouseEvent(eventType, options) {
        try {
            // Получаем координаты относительно окна
            const screenX = options.clientX;
            const screenY = options.clientY;
            
            // Для безопасности проверяем, активно ли захват экрана
            if (!this.isCapturing && eventType !== 'mousemove') {
                this.logger.warn(`Игнорирование события ${eventType}, так как захват не активен`);
                return;
            }
            
            // Находим элемент под указанными координатами
            const elementAtPoint = document.elementFromPoint(screenX, screenY);
            
            if (!elementAtPoint) {
                this.logger.warn(`Не найден элемент по координатам (${screenX}, ${screenY})`);
                return;
            }
            
            // Выводим информацию о целевом элементе для отладки
            const elementInfo = `${elementAtPoint.tagName}${elementAtPoint.id ? '#'+elementAtPoint.id : ''}${elementAtPoint.className ? '.'+elementAtPoint.className.replace(/\s+/g, '.') : ''}`;
            this.logger.log(`Обработка события ${eventType} на элементе ${elementInfo} по координатам (${screenX}, ${screenY})`);
            
            // Задаем актуальные координаты относительно документа
            const rect = elementAtPoint.getBoundingClientRect();
            const updatedOptions = {
                ...options,
                view: window,
                bubbles: true,
                cancelable: true
            };
            
            // Создаем и отправляем событие с использованием MouseEvent
            const event = new MouseEvent(eventType, updatedOptions);
            
            // Устанавливаем атрибут detail для двойного клика
            if (eventType === 'dblclick') {
                event.detail = 2;
            }
            
            // Диспатчим событие
            const dispatched = elementAtPoint.dispatchEvent(event);
            
            this.logger.log(`Выполнено событие мыши ${eventType} на элементе ${elementAtPoint.tagName} (${dispatched ? 'обработано' : 'отменено'}) по координатам (${screenX}, ${screenY})`);
            
            // Дополнительно обрабатываем клик для различных элементов
            if (eventType === 'click' || (eventType === 'mouseup' && options.button === 0)) {
                // Если это кнопка, ссылка или другой кликабельный элемент - активируем его
                if (elementAtPoint.tagName === 'A' || 
                    elementAtPoint.tagName === 'BUTTON' || 
                    elementAtPoint.getAttribute('role') === 'button' ||
                    elementAtPoint.tagName === 'INPUT' && 
                    (elementAtPoint.type === 'button' || 
                     elementAtPoint.type === 'submit' || 
                     elementAtPoint.type === 'checkbox' || 
                     elementAtPoint.type === 'radio')) {
                    
                    this.logger.log(`Активация элемента: ${elementAtPoint.tagName}`);
                    elementAtPoint.click();
                }
                
                // Для поля ввода устанавливаем фокус
                if (elementAtPoint.tagName === 'INPUT' || 
                    elementAtPoint.tagName === 'TEXTAREA' || 
                    elementAtPoint.isContentEditable) {
                    elementAtPoint.focus();
                    this.logger.log(`Установлен фокус на элемент: ${elementAtPoint.tagName}`);
                }
            }
            
            // Для правого клика (ПКМ) эмулируем контекстное меню
            if (eventType === 'mouseup' && options.button === 2) {
                const contextEvent = new MouseEvent('contextmenu', updatedOptions);
                elementAtPoint.dispatchEvent(contextEvent);
                this.logger.log(`Выполнено событие contextmenu на элементе ${elementAtPoint.tagName}`);
            }
        } catch (error) {
            this.logger.error(`Ошибка имитации события мыши: ${error.message}`);
        }
    }
    
    /**
     * Имитирует событие клавиатуры
     * @param {string} eventType Тип события
     * @param {Object} options Параметры события
     */
    _simulateKeyboardEvent(eventType, options) {
        try {
            // Для безопасности проверяем, активно ли захват экрана
            if (!this.isCapturing) {
                this.logger.warn(`Игнорирование события ${eventType}, так как захват не активен`);
                return;
            }
            
            // Находим активный элемент для ввода
            let targetElement = document.activeElement;
            
            // Если активный элемент не подходит для ввода, пробуем найти
            // актуальный элемент ввода на странице
            if (!targetElement || 
                (targetElement.tagName !== 'INPUT' && 
                 targetElement.tagName !== 'TEXTAREA' && 
                 !targetElement.isContentEditable)) {
                
                // Находим первый видимый элемент ввода
                const inputs = document.querySelectorAll('input[type="text"], input[type="password"], textarea, [contenteditable="true"]');
                for (const input of inputs) {
                    if (input.offsetParent !== null) {  // проверка видимости
                        targetElement = input;
                        
                        // Устанавливаем фокус на элемент, если он еще не в фокусе
                        if (document.activeElement !== input) {
                            input.focus();
                            this.logger.log(`Установлен фокус на элемент ввода: ${input.tagName}${input.id ? '#'+input.id : ''}`);
                        }
                        break;
                    }
                }
            }
            
            // Создаем объект события
            const keyEvent = new KeyboardEvent(eventType, {
                ...options,
                bubbles: true,
                cancelable: true,
                // Важно: для корректной работы в разных браузерах
                code: options.code || options.key,
                key: options.key,
                keyCode: options.keyCode || options.key.charCodeAt(0),
                which: options.keyCode || options.key.charCodeAt(0),
                // Модификаторы
                altKey: options.altKey || false,
                ctrlKey: options.ctrlKey || false,
                shiftKey: options.shiftKey || false,
                metaKey: options.metaKey || false
            });
            
            // Если элемент найден, отправляем событие
            if (targetElement && (targetElement.tagName === 'INPUT' || 
                                 targetElement.tagName === 'TEXTAREA' || 
                                 targetElement.isContentEditable)) {
                
                // Диспатчим событие на целевой элемент
                const dispatched = targetElement.dispatchEvent(keyEvent);
                this.logger.log(`Выполнено событие клавиатуры ${eventType} с клавишей ${options.key} на элементе ${targetElement.tagName} (${dispatched ? 'обработано' : 'отменено'})`);
                
                // Для event keydown и печатаемых символов также обновляем значение элемента
                if (eventType === 'keydown' && 
                    options.key && 
                    options.key.length === 1 && 
                    (targetElement.tagName === 'INPUT' || targetElement.tagName === 'TEXTAREA')) {
                    
                    if (targetElement.value !== undefined) {
                        // Для обычных полей ввода
                        const position = targetElement.selectionStart || targetElement.value.length;
                        const newValue = targetElement.value.slice(0, position) + 
                                        options.key + 
                                        targetElement.value.slice(position);
                        targetElement.value = newValue;
                        targetElement.selectionStart = position + 1;
                        targetElement.selectionEnd = position + 1;
                        
                        // Генерируем событие input для обновления
                        const inputEvent = new Event('input', { bubbles: true });
                        targetElement.dispatchEvent(inputEvent);
                        
                        // Для форм также генерируем событие change
                        if (targetElement.form) {
                            const changeEvent = new Event('change', { bubbles: true });
                            targetElement.dispatchEvent(changeEvent);
                        }
                        
                        this.logger.log(`Обновлено значение элемента: '${targetElement.value}'`);
                    }
                }
                
                // Обработка специальных клавиш
                if (eventType === 'keydown') {
                    // Enter - имитация нажатия на кнопку или submit формы
                    if (options.key === 'Enter') {
                        if (targetElement.form) {
                            const submitBtn = targetElement.form.querySelector('input[type="submit"], button[type="submit"]');
                            if (submitBtn) {
                                submitBtn.click();
                                this.logger.log('Выполнен submit формы по нажатию Enter');
                            } else {
                                // Если нет кнопки Submit, пробуем отправить форму напрямую
                                targetElement.form.submit();
                                this.logger.log('Форма отправлена по нажатию Enter');
                            }
                        }
                    }
                    
                    // Tab - переключение между полями ввода
                    if (options.key === 'Tab') {
                        // Находим все поля ввода
                        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"], button, a[href], select'));
                        const focusableInputs = inputs.filter(input => input.offsetParent !== null);
                        
                        if (focusableInputs.length > 1) {
                            const currentIndex = focusableInputs.indexOf(targetElement);
                            let nextIndex = options.shiftKey ? currentIndex - 1 : currentIndex + 1;
                            
                            // Циклический переход
                            if (nextIndex < 0) nextIndex = focusableInputs.length - 1;
                            if (nextIndex >= focusableInputs.length) nextIndex = 0;
                            
                            focusableInputs[nextIndex].focus();
                            this.logger.log(`Перемещение фокуса на элемент: ${focusableInputs[nextIndex].tagName}`);
                        }
                    }
                }
            } else {
                // Если не нашли подходящий элемент, отправляем событие в документ
                const dispatched = document.dispatchEvent(keyEvent);
                this.logger.log(`Выполнено глобальное событие клавиатуры ${eventType} с клавишей ${options.key} (${dispatched ? 'обработано' : 'отменено'})`);
                
                // Специальные комбинации клавиш, требующие глобальной обработки
                if (eventType === 'keydown') {
                    // Ctrl+F (поиск)
                    if (options.ctrlKey && options.key === 'f') {
                        const searchInput = document.querySelector('input[type="search"]');
                        if (searchInput) {
                            searchInput.focus();
                            this.logger.log('Фокусировка на поле поиска по Ctrl+F');
                        }
                    }
                    
                    // Escape - закрытие диалогов
                    if (options.key === 'Escape') {
                        const closeButtons = document.querySelectorAll('.close, .btn-close, [data-dismiss="modal"]');
                        if (closeButtons.length > 0) {
                            closeButtons[0].click();
                            this.logger.log('Закрытие модального окна по клавише Escape');
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.error(`Ошибка имитации события клавиатуры: ${error.message}`);
        }
    }
    
    /**
     * Имитирует событие прокрутки
     * @param {Object} options Параметры события
     */
    _simulateWheelEvent(options) {
        try {
            // Для безопасности проверяем, активно ли захват экрана
            if (!this.isCapturing) {
                this.logger.warn('Игнорирование события прокрутки, так как захват не активен');
                return;
            }
            
            // Находим элемент с прокруткой под текущей позицией мыши
            // или используем body как запасной вариант
            let scrollableElement = document.elementFromPoint(
                window.innerWidth / 2, 
                window.innerHeight / 2
            );
            
            // Проверяем, является ли элемент прокручиваемым
            while (scrollableElement && 
                  !(scrollableElement.scrollHeight > scrollableElement.clientHeight || 
                    scrollableElement.scrollWidth > scrollableElement.clientWidth)) {
                scrollableElement = scrollableElement.parentElement;
            }
            
            // Если не нашли прокручиваемый элемент, используем document.documentElement
            if (!scrollableElement || scrollableElement === document.body) {
                scrollableElement = document.documentElement;
            }
            
            // Создаем событие wheel
            const event = new WheelEvent('wheel', {
                ...options,
                bubbles: true,
                cancelable: true
            });
            
            // Отправляем событие
            scrollableElement.dispatchEvent(event);
            
            // Также напрямую прокручиваем элемент для большей надежности
            if (options.deltaY !== 0) {
                scrollableElement.scrollTop += options.deltaY;
            }
            
            if (options.deltaX !== 0) {
                scrollableElement.scrollLeft += options.deltaX;
            }
            
            this.logger.log(`Выполнено событие прокрутки (deltaX=${options.deltaX}, deltaY=${options.deltaY})`);
        } catch (error) {
            this.logger.error(`Ошибка имитации события прокрутки: ${error.message}`);
        }
    }
} 