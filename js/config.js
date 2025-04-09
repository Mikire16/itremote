/**
 * Конфигурационный файл приложения ITRemote
 * Содержит настройки Firebase и другие глобальные параметры
 */

// Конфигурация Firebase для подключения к серверу
const firebaseConfig = {
    apiKey: "AIzaSyC6IiMI7egRJQ5SuiAx5oUfTrPe4gt9Wjk",
    authDomain: "clanchat-1db1a.firebaseapp.com",
    databaseURL: "https://clanchat-1db1a-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "clanchat-1db1a",
    storageBucket: "clanchat-1db1a.appspot.com",
    messagingSenderId: "1011639001847",
    appId: "1:1011639001847:web:f31df91e4b4d4eb29029f2"
};

// Инициализация Firebase при загрузке файла
firebase.initializeApp(firebaseConfig); 