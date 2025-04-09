/**
 * Сервис для работы с Firebase
 * Отвечает за взаимодействие с Firebase Realtime Database:
 * - Передача изображений экрана
 * - Отправка и получение команд управления
 * - Генерация кодов подключения
 */
class FirebaseService {
    /**
     * Инициализация сервиса Firebase
     * Настраивает соединение и ограничения
     */
    constructor() {
        this.database = null;
        this.connected = false;
        this.logger = new Logger('FirebaseService');
        
        // Инициализация Firebase
        this.initializeFirebase();
        
        // Базовый URL для Firebase Realtime Database
        this.firebaseUrl = 'https://clanchat-1db1a-default-rtdb.europe-west1.firebasedatabase.app/';
        
        // URL для Firebase Storage (для хранения больших файлов)
        this.firebaseStorageUrl = 'gs://clanchat-1db1a.appspot.com';
        
        // Ограничения для запросов
        this.maxConcurrentRequests = 5;  // Максимальное количество одновременных запросов
        this.requestTimeoutMs = 10000;   // Таймаут запроса (10 секунд)
        this.uploadIntervalMs = 50;      // Минимальный интервал между загрузками (50 мс)
        
        this.lastUploadTime = 0;
        
        // Создаем семафор для ограничения одновременных запросов
        this.semaphore = new Semaphore(this.maxConcurrentRequests);
    }
    
    /**
     * Инициализирует Firebase
     */
    initializeFirebase() {
        try {
            const firebaseConfig = {
                apiKey: "AIzaSyC6IiMI7egRJQ5SuiAx5oUfTrPe4gt9Wjk",
                authDomain: "clanchat-1db1a.firebaseapp.com",
                databaseURL: "https://clanchat-1db1a-default-rtdb.europe-west1.firebasedatabase.app",
                projectId: "clanchat-1db1a",
                storageBucket: "clanchat-1db1a.appspot.com",
                messagingSenderId: "1011639001847",
                appId: "1:1011639001847:web:f31df91e4b4d4eb29029f2"
              };
            
            // Инициализация Firebase
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
            
            // Получаем ссылку на базу данных
            this.database = firebase.database();
            
            // Проверяем подключение
            this.database.ref('.info/connected').on('value', (snapshot) => {
                this.connected = snapshot.val() === true;
                this.logger.log(`Состояние подключения к Firebase: ${this.connected ? 'подключено' : 'отключено'}`);
            });
            
            this.logger.success('Firebase инициализирован');
        } catch (error) {
            this.logger.error(`Ошибка инициализации Firebase: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Проверяет подключение к Firebase
     * @returns {Promise<boolean>} Результат проверки
     */
    async checkConnection() {
        try {
            const connected = await this.database.ref('.info/connected').once('value');
            this.connected = connected.val() === true;
            return this.connected;
        } catch (error) {
            this.connected = false;
            this.logger.error(`Ошибка проверки подключения: ${error.message}`);
            return false;
        }
    }

    /**
     * Отправляет изображение экрана в Firebase
     * @param {string} code Код подключения
     * @param {string} base64Image Изображение в формате base64
     * @returns {Promise<boolean>} Результат отправки
     */
    async sendScreenImageData(code, base64Image) {
        if (!code || !base64Image) {
            throw new Error('Неверные параметры для отправки изображения');
        }

        const now = Date.now();
        if (now - this.lastUploadTime < this.uploadIntervalMs) {
            await new Promise(resolve => setTimeout(resolve, this.uploadIntervalMs));
        }

        try {
            await this.semaphore.acquire();
            this.lastUploadTime = Date.now();

            const response = await fetch(`${this.firebaseUrl}/sessions/${code}/screen.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: base64Image,
                    timestamp: now
                })
            });

            if (!response.ok) {
                throw new Error(`Ошибка HTTP: ${response.status}`);
            }

            this.logger.log('Изображение успешно отправлено');
            return true;
        } catch (error) {
            this.logger.error(`Ошибка при отправке изображения: ${error.message}`);
            throw error;
        } finally {
            this.semaphore.release();
        }
    }

    /**
     * Получает изображение экрана из Firebase
     * @param {string} connectionCode Код подключения
     * @returns {Promise<string>} Изображение в формате base64
     */
    async getScreenImageData(connectionCode) {
        if (!connectionCode) {
            throw new Error('Код подключения не указан');
        }

        try {
            await this.semaphore.acquire();
            const response = await fetch(`${this.firebaseUrl}/sessions/${connectionCode}/screen.json`, {
                timeout: this.requestTimeoutMs
            });

            if (!response.ok) {
                throw new Error(`Ошибка HTTP: ${response.status}`);
            }

            const data = await response.json();
            return data?.image || null;
        } catch (error) {
            this.logger.error(`Ошибка при получении изображения: ${error.message}`);
            throw error;
        } finally {
            this.semaphore.release();
        }
    }

    /**
     * Создает новый код подключения
     * @returns {string} Новый код подключения
     */
    generateConnectionCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    async sendControlCommand(code, command) {
        if (!code || !command) {
            throw new Error('Неверные параметры для отправки команды');
        }

        try {
            await this.semaphore.acquire();
            const response = await fetch(`${this.firebaseUrl}/sessions/${code}/commands.json`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...command,
                    timestamp: Date.now()
                })
            });

            if (!response.ok) {
                throw new Error(`Ошибка HTTP: ${response.status}`);
            }

            this.logger.log('Команда успешно отправлена');
        } catch (error) {
            this.logger.error(`Ошибка при отправке команды: ${error.message}`);
            throw error;
        } finally {
            this.semaphore.release();
        }
    }

    async getControlCommands(code, lastCommandId) {
        if (!code) {
            throw new Error('Код подключения не указан');
        }

        try {
            await this.semaphore.acquire();
            const url = lastCommandId 
                ? `${this.firebaseUrl}/sessions/${code}/commands.json?orderBy="timestamp"&startAt=${lastCommandId}`
                : `${this.firebaseUrl}/sessions/${code}/commands.json`;

            const response = await fetch(url, {
                timeout: this.requestTimeoutMs
            });

            if (!response.ok) {
                throw new Error(`Ошибка HTTP: ${response.status}`);
            }

            const data = await response.json();
            return data ? Object.values(data) : [];
        } catch (error) {
            this.logger.error(`Ошибка при получении команд: ${error.message}`);
            throw error;
        } finally {
            this.semaphore.release();
        }
    }

    /**
     * Получает информацию о сессии
     * @param {string} connectionCode Код подключения
     * @returns {Promise<Object>} Информация о сессии
     */
    async getSessionInfo(connectionCode) {
        if (!this.connected) {
            throw new Error('Нет подключения к Firebase');
        }

        try {
            const snapshot = await this.database.ref(`sessions/${connectionCode}`).once('value');
            if (!snapshot.exists()) {
                return null;
            }
            
            const data = snapshot.val();
            return {
                active: data.status === 'active',
                createdAt: data.timestamp,
                closedAt: data.closedAt || null
            };
        } catch (error) {
            this.logger.error(`Ошибка получения информации о сессии: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Регистрирует новую сессию в Firebase
     * @param {string} connectionCode Код подключения
     * @returns {Promise<void>}
     */
    async registerSession(connectionCode) {
        if (!this.connected) {
            throw new Error('Нет подключения к Firebase');
        }

        try {
            await this.database.ref(`sessions/${connectionCode}`).set({
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                status: 'active'
            });
            this.logger.success(`Сессия ${connectionCode} зарегистрирована`);
        } catch (error) {
            this.logger.error(`Ошибка регистрации сессии: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Закрывает сессию в Firebase
     * @param {string} connectionCode Код подключения
     * @returns {Promise<void>}
     */
    async closeSession(connectionCode) {
        if (!this.connected) {
            throw new Error('Нет подключения к Firebase');
        }

        try {
            await this.database.ref(`sessions/${connectionCode}`).update({
                status: 'closed',
                closedAt: firebase.database.ServerValue.TIMESTAMP
            });
            this.logger.success(`Сессия ${connectionCode} закрыта`);
        } catch (error) {
            this.logger.error(`Ошибка закрытия сессии: ${error.message}`);
            throw error;
        }
    }

    /**
     * Проверяет существование сессии
     * @param {string} connectionCode Код подключения
     * @returns {Promise<boolean>}
     */
    async checkSessionExists(connectionCode) {
        if (!this.connected) {
            throw new Error('Нет подключения к Firebase');
        }

        try {
            const snapshot = await this.database.ref(`sessions/${connectionCode}`).once('value');
            return snapshot.exists();
        } catch (error) {
            this.logger.error(`Ошибка проверки сессии: ${error.message}`);
            throw error;
        }
    }

    /**
     * Получает статус сессии
     * @param {string} connectionCode Код подключения
     * @returns {Promise<string>}
     */
    async getSessionStatus(connectionCode) {
        if (!this.connected) {
            throw new Error('Нет подключения к Firebase');
        }

        try {
            const snapshot = await this.database.ref(`sessions/${connectionCode}/status`).once('value');
            return snapshot.val() || 'unknown';
        } catch (error) {
            this.logger.error(`Ошибка получения статуса сессии: ${error.message}`);
            throw error;
        }
    }
}

/**
 * Класс для ограничения количества одновременных запросов
 * Используется в FirebaseService для контроля количества одновременных HTTP запросов
 */
class Semaphore {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.current = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.current < this.maxConcurrent) {
            this.current++;
            return;
        }

        await new Promise(resolve => this.queue.push(resolve));
    }

    release() {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            next();
        } else {
            this.current--;
        }
    }
}

/**
 * Класс для логирования
 * Используется всеми сервисами для записи сообщений в консоль и UI
 */
class Logger {
    constructor(prefix) {
        this.prefix = prefix;
        this.logElement = document.getElementById('log');
    }

    /**
     * Добавляет сообщение в лог
     * @param {string} message Сообщение
     * @param {string} type Тип сообщения (log, error, warn, success)
     */
    addLogEntry(message, type = '') {
        if (!this.logElement) return;
        
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] [${this.prefix}] ${message}`;
        
        this.logElement.appendChild(entry);
        this.logElement.scrollTop = this.logElement.scrollHeight;
        
        // Ограничиваем количество записей в логе
        while (this.logElement.children.length > 100) {
            this.logElement.removeChild(this.logElement.firstChild);
        }
    }

    /**
     * Логирует обычное сообщение
     * @param {string} message Сообщение
     */
    log(message) {
        console.log(`[${this.prefix}] ${message}`);
        this.addLogEntry(message);
    }

    /**
     * Логирует сообщение об ошибке
     * @param {string} message Сообщение
     */
    error(message) {
        console.error(`[${this.prefix}] ${message}`);
        this.addLogEntry(message, 'error');
    }

    /**
     * Логирует предупреждение
     * @param {string} message Сообщение
     */
    warn(message) {
        console.warn(`[${this.prefix}] ${message}`);
        this.addLogEntry(message, 'warning');
    }

    /**
     * Логирует сообщение об успехе
     * @param {string} message Сообщение
     */
    success(message) {
        console.log(`[${this.prefix}] ${message}`);
        this.addLogEntry(message, 'success');
    }
} 