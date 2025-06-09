// background.js
class TimeManagerBackground {
    constructor() {
        this.initializeExtension();
    }

    initializeExtension() {
        chrome.runtime.onInstalled.addListener(this.handleInstallation.bind(this));
        chrome.runtime.onStartup.addListener(this.handleStartup.bind(this));
    }

    handleInstallation(details) {
        console.log("Time Manager Extension installée et prête !");
        
        if (details.reason === 'install') {
            this.logInstallation();
        } else if (details.reason === 'update') {
            this.logUpdate(details.previousVersion);
        }
    }

    handleStartup() {
        console.log("Time Manager Extension démarrée");
    }

    logInstallation() {
        console.log("Première installation de Time Manager Extension");
    }

    logUpdate(previousVersion) {
        console.log(`Time Manager Extension mise à jour depuis la version ${previousVersion}`);
    }
}

// Initialisation du service worker
new TimeManagerBackground();