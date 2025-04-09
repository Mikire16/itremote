/**
 * Сервис для работы с WebRTC
 * Реализует прямую передачу видеопотока между клиентами
 * 
 * Связи с другими компонентами:
 * - Использует Firebase для сигналинга (обмена SDP и ICE кандидатами)
 * - Предоставляет API для ScreenCapture для передачи видеопотока
 * - Генерирует события, которые обрабатываются в app.js
 */
class WebRTCService {
    /**
     * Инициализация WebRTC сервиса
     * Подготавливает необходимые переменные и настройки для WebRTC соединения
     */
    constructor() {
        // Основные компоненты WebRTC
        this.peerConnection = null;      // RTCPeerConnection объект
        this.dataChannel = null;         // Канал для передачи данных (команд управления)
        this.localStream = null;         // Локальный медиапоток (с экрана)
        this.remoteStream = null;        // Удаленный медиапоток (принимаемый)
        
        // Состояние соединения
        this.isInitiator = false;        // Флаг инициатора соединения
        this.isConnected = false;        // Статус подключения
        this.connectionCode = '';        // Код для подключения
        
        // ICE сервера для обхода NAT/фаерволов
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };
        
        // Firebase используется только для сигналинга (обмена SDP и ICE)
        this.database = firebase.database();
        
        // Логгер для отладки
        this.logger = new Logger('WebRTCService');
    }
    
    /**
     * Инициализирует WebRTC соединение
     * Создает PeerConnection, настраивает обработчики событий и начинает сигналинг
     * 
     * @param {string} connectionCode Код подключения
     * @param {boolean} isInitiator Флаг инициатора соединения
     */
    async initialize(connectionCode, isInitiator) {
        try {
            this.connectionCode = connectionCode;
            this.isInitiator = isInitiator;
            
            this.logger.log(`Инициализация WebRTC как ${isInitiator ? 'инициатор' : 'получатель'}`);
            
            // Создаем PeerConnection
            this.peerConnection = new RTCPeerConnection(this.iceServers);
            
            // Обработчики событий WebRTC
            this.peerConnection.onicecandidate = (event) => this.handleIceCandidate(event);
            this.peerConnection.ontrack = (event) => this.handleTrack(event);
            this.peerConnection.oniceconnectionstatechange = () => this.handleConnectionStateChange();
            
            // Создаем канал данных для передачи команд управления
            if (isInitiator) {
                // Инициатор создает канал данных и слушает ответы
                this.dataChannel = this.peerConnection.createDataChannel('commands');
                this.setupDataChannel();
                
                // Если мы инициатор, начинаем слушать ответы от другой стороны
                this.listenForAnswer();
            } else {
                // Получатель ожидает канал данных и слушает предложения
                this.peerConnection.ondatachannel = (event) => {
                    this.dataChannel = event.channel;
                    this.setupDataChannel();
                };
                
                this.listenForOffer();
            }
            
            // Слушаем ICE кандидатов
            this.listenForCandidates();
        } catch (error) {
            this.logger.error(`Ошибка при инициализации WebRTC: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Настраивает канал данных
     */
    setupDataChannel() {
        if (!this.dataChannel) return;
        
        this.dataChannel.onopen = () => {
            this.logger.success('Канал данных открыт');
            // Отправляем событие открытия канала
            const event = new CustomEvent('datachannel-open');
            document.dispatchEvent(event);
        };
        
        this.dataChannel.onclose = () => {
            this.logger.warn('Канал данных закрыт');
            // Отправляем событие закрытия канала
            const event = new CustomEvent('datachannel-close');
            document.dispatchEvent(event);
        };
        
        this.dataChannel.onerror = (error) => {
            this.logger.error(`Ошибка канала данных: ${error}`);
            // Отправляем событие ошибки канала
            const event = new CustomEvent('datachannel-error', { detail: { error } });
            document.dispatchEvent(event);
        };
        
        this.dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleDataChannelMessage(message);
            } catch (error) {
                this.logger.error(`Ошибка обработки сообщения: ${error.message}`);
            }
        };
    }
    
    /**
     * Обрабатывает сообщения из канала данных
     * @param {Object} message Сообщение
     */
    handleDataChannelMessage(message) {
        if (!message || typeof message !== 'object') {
            this.logger.error('Получено некорректное сообщение');
            return;
        }

        this.logger.log(`Получено сообщение: ${JSON.stringify(message)}`);
        
        // Генерируем событие для обработки сообщения
        const event = new CustomEvent('webrtc-message', { detail: message });
        document.dispatchEvent(event);
    }
    
    /**
     * Отправляет сообщение через канал данных
     * @param {Object} message Сообщение
     * @returns {boolean} Успешность отправки
     */
    sendMessage(message) {
        if (!this.dataChannel) {
            this.logger.error('Канал данных не создан');
            return false;
        }
        
        if (this.dataChannel.readyState !== 'open') {
            this.logger.error(`Канал данных не открыт (состояние: ${this.dataChannel.readyState})`);
            return false;
        }
        
        try {
            const messageString = JSON.stringify(message);
            this.dataChannel.send(messageString);
            return true;
        } catch (error) {
            this.logger.error(`Ошибка отправки сообщения: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Добавляет локальный медиапоток
     * @param {MediaStream} stream Медиапоток
     */
    addLocalStream(stream) {
        if (!stream) {
            this.logger.error('Невозможно добавить пустой медиапоток');
            return;
        }
        
        if (!this.peerConnection) {
            this.logger.error('PeerConnection не инициализирован. Вызовите initialize() перед addLocalStream()');
            throw new Error('PeerConnection не инициализирован');
        }
        
        this.localStream = stream;
        
        stream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, stream);
            this.logger.log(`Добавлен трек ${track.kind}`);
        });
    }
    
    /**
     * Обрабатывает событие получения трека
     * @param {RTCTrackEvent} event Событие
     */
    handleTrack(event) {
        this.logger.log(`Получен трек ${event.track.kind}`);
        
        if (!this.remoteStream) {
            this.remoteStream = new MediaStream();
            
            // Генерируем событие для обработки нового потока
            const streamEvent = new CustomEvent('webrtc-stream', { detail: this.remoteStream });
            document.dispatchEvent(streamEvent);
        }
        
        this.remoteStream.addTrack(event.track);
    }
    
    /**
     * Обрабатывает ICE кандидата
     * @param {RTCPeerConnectionIceEvent} event Событие
     */
    async handleIceCandidate(event) {
        if (!event.candidate) return;
        
        this.logger.log('Получен ICE кандидат');
        
        try {
            // Отправляем ICE кандидата через Firebase
            await this.database.ref(`signaling/${this.connectionCode}/${this.isInitiator ? 'initiatorCandidates' : 'receiverCandidates'}`).push({
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex
            });
        } catch (error) {
            this.logger.error(`Ошибка отправки ICE кандидата: ${error.message}`);
        }
    }
    
    /**
     * Обрабатывает изменение состояния соединения
     */
    handleConnectionStateChange() {
        const state = this.peerConnection.iceConnectionState;
        this.logger.log(`Состояние ICE соединения: ${state}`);
        
        if (state === 'connected' || state === 'completed') {
            this.isConnected = true;
            
            // Генерируем событие для обработки подключения
            const event = new CustomEvent('webrtc-connected');
            document.dispatchEvent(event);
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            this.isConnected = false;
            
            // Генерируем событие для обработки отключения
            const event = new CustomEvent('webrtc-disconnected', { detail: { state } });
            document.dispatchEvent(event);
        }
    }
    
    /**
     * Создает и отправляет предложение (offer)
     */
    async createOffer() {
        if (!this.peerConnection) {
            this.logger.error('PeerConnection не инициализирован');
            return;
        }
        
        try {
            this.logger.log('Создание предложения (offer)');
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            // Отправляем предложение через Firebase
            await this.database.ref(`signaling/${this.connectionCode}/offer`).set({
                type: offer.type,
                sdp: offer.sdp,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
            
            this.logger.success('Предложение отправлено');
        } catch (error) {
            this.logger.error(`Ошибка создания предложения: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Слушает предложение (offer)
     */
    listenForOffer() {
        this.database.ref(`signaling/${this.connectionCode}/offer`).on('value', async (snapshot) => {
            const data = snapshot.val();
            if (!data) return;
            
            try {
                this.logger.log('Получено предложение (offer)');
                
                const offer = new RTCSessionDescription(data);
                await this.peerConnection.setRemoteDescription(offer);
                
                // Создаем и отправляем ответ
                const answer = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(answer);
                
                await this.database.ref(`signaling/${this.connectionCode}/answer`).set({
                    type: answer.type,
                    sdp: answer.sdp,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                });
                
                this.logger.success('Ответ отправлен');
            } catch (error) {
                this.logger.error(`Ошибка обработки предложения: ${error.message}`);
            }
        });
    }
    
    /**
     * Слушает ответ (answer)
     */
    listenForAnswer() {
        this.database.ref(`signaling/${this.connectionCode}/answer`).on('value', async (snapshot) => {
            const data = snapshot.val();
            if (!data) return;
            
            try {
                this.logger.log('Получен ответ (answer)');
                
                const answer = new RTCSessionDescription(data);
                await this.peerConnection.setRemoteDescription(answer);
                
                this.logger.success('Ответ применен');
            } catch (error) {
                this.logger.error(`Ошибка обработки ответа: ${error.message}`);
            }
        });
    }
    
    /**
     * Слушает ICE кандидатов
     */
    listenForCandidates() {
        // Слушаем кандидатов от противоположной стороны
        const candidatesRef = this.database.ref(`signaling/${this.connectionCode}/${this.isInitiator ? 'receiverCandidates' : 'initiatorCandidates'}`);
        
        candidatesRef.on('child_added', async (snapshot) => {
            const data = snapshot.val();
            if (!data) return;
            
            try {
                this.logger.log('Получен удаленный ICE кандидат');
                
                const candidate = new RTCIceCandidate({
                    candidate: data.candidate,
                    sdpMid: data.sdpMid,
                    sdpMLineIndex: data.sdpMLineIndex
                });
                
                await this.peerConnection.addIceCandidate(candidate);
            } catch (error) {
                this.logger.error(`Ошибка добавления ICE кандидата: ${error.message}`);
            }
        });
    }
    
    /**
     * Очищает данные сигналинга
     */
    async cleanupSignaling() {
        if (!this.connectionCode) return;
        
        try {
            await this.database.ref(`signaling/${this.connectionCode}`).remove();
            this.logger.log('Данные сигналинга очищены');
        } catch (error) {
            this.logger.error(`Ошибка очистки данных сигналинга: ${error.message}`);
        }
    }
    
    /**
     * Закрывает соединение
     */
    close() {
        try {
            // Останавливаем все треки локального потока
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }
            
            // Закрываем канал данных
            if (this.dataChannel) {
                this.dataChannel.close();
                this.dataChannel = null;
            }
            
            // Закрываем соединение
            if (this.peerConnection) {
                this.peerConnection.close();
                this.peerConnection = null;
            }
            
            // Очищаем данные сигналинга
            this.cleanupSignaling();
            
            this.isConnected = false;
            this.logger.log('Соединение закрыто');
        } catch (error) {
            this.logger.error(`Ошибка закрытия соединения: ${error.message}`);
        }
    }
    
    /**
     * Генерирует случайный код подключения
     * @returns {string} Код подключения
     */
    generateConnectionCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }
} 