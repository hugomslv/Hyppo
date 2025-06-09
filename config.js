// config.js
// Configuration chargée depuis le storage Chrome
window.TIME_MANAGER_CONFIG = null;

// Configuration par défaut
const DEFAULT_CONFIG = {
    DAILY_WORK_HOURS: 8.4,
    WORKING_DAYS_PER_WEEK: 5,
    LANGUAGE: 'fr',
    ROWS_TO_CONVERT_TO_DAYS: [],
    ROWS_TO_REMOVE: [],
    LUNCH_BREAK: {
        START_HOUR: 11,
        END_HOUR: 14,
        MINIMUM_DURATION_MINUTES: 30
    }
};

// Chargement de la configuration depuis le storage
async function loadConfiguration() {
    try {
        const result = await chrome.storage.sync.get('timeManagerConfig');
        window.TIME_MANAGER_CONFIG = result.timeManagerConfig || DEFAULT_CONFIG;
        console.log('Configuration chargée:', window.TIME_MANAGER_CONFIG);
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration:', error);
        window.TIME_MANAGER_CONFIG = DEFAULT_CONFIG;
    }
}

// Charger la configuration au démarrage
loadConfiguration();