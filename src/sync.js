import { global } from './vars.js';
import { firebaseConfig } from './sync-config.js';

// Sync state — not persisted in the save file. Firebase Auth handles session persistence.
const syncState = {
    signedIn: false,
    email: null,
    lastSync: null,
    error: null
};

let db = null;
let auth = null;
let initialized = false;

function isConfigured() {
    return firebaseConfig.apiKey !== "REPLACE_ME" && firebaseConfig.projectId !== "REPLACE_ME";
}

// Initialize Firebase app, auth, and Firestore. Safe to call multiple times.
export function initSync() {
    if (initialized || !isConfigured()) {
        return;
    }
    if (typeof firebase === 'undefined') {
        console.warn('[sync] Firebase SDK not loaded');
        return;
    }
    try {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        initialized = true;

        auth.onAuthStateChanged(function(user) {
            if (user) {
                syncState.signedIn = true;
                syncState.email = user.email;
                syncState.error = null;
            } else {
                syncState.signedIn = false;
                syncState.email = null;
                syncState.lastSync = null;
            }
        });
    } catch (e) {
        console.error('[sync] Firebase init failed:', e);
        syncState.error = 'Firebase initialization failed';
    }
}

// Trigger Google Sign-In popup.
export function signIn() {
    if (!auth) { return; }
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(function(e) {
        console.error('[sync] Sign-in failed:', e);
        syncState.error = 'Sign-in failed: ' + e.message;
    });
}

// Sign out of Firebase Auth.
export function signOut() {
    if (!auth) { return; }
    auth.signOut().catch(function(e) {
        console.error('[sync] Sign-out failed:', e);
    });
}

// Upload current game state to Firestore /saves/{uid}.
export function uploadSave() {
    if (!db || !auth || !auth.currentUser) { return; }
    if (global.race && global.race['noexport']) { return; }

    try {
        const saveData = LZString.compressToBase64(JSON.stringify(global));
        const uid = auth.currentUser.uid;
        db.collection('saves').doc(uid).set({
            saveData: saveData,
            timestamp: Date.now(),
            version: global['version'] || 'unknown'
        }).then(function() {
            syncState.lastSync = Date.now();
            syncState.error = null;
        }).catch(function(e) {
            console.error('[sync] Upload failed:', e);
            syncState.error = 'Upload failed: ' + e.message;
        });
    } catch (e) {
        console.error('[sync] Upload serialization failed:', e);
        syncState.error = 'Save serialization failed';
    }
}

// Fetch the cloud save document for the current user. Returns the document data or null.
function fetchCloudSave() {
    if (!db || !auth || !auth.currentUser) {
        return Promise.resolve(null);
    }
    const uid = auth.currentUser.uid;
    return db.collection('saves').doc(uid).get().then(function(doc) {
        if (doc.exists) {
            return doc.data();
        }
        return null;
    }).catch(function(e) {
        console.error('[sync] Download failed:', e);
        syncState.error = 'Download failed: ' + e.message;
        return null;
    });
}

// Download cloud save and import it (triggers page reload via importGame).
export function downloadSave() {
    return fetchCloudSave().then(function(data) {
        if (data && data.saveData) {
            window.importGame(data.saveData);
        }
    });
}

// Compare cloud save timestamp vs local, prompt user if cloud is newer.
// Called once after sign-in is detected on page load.
export function checkCloudSave() {
    if (!initialized) { return; }

    // Wait for auth state to settle, then check.
    // Firebase auth state may not be ready immediately; onAuthStateChanged fires asynchronously.
    const unsubscribe = auth.onAuthStateChanged(function(user) {
        unsubscribe(); // Only run once.
        if (!user) { return; }

        fetchCloudSave().then(function(cloudData) {
            if (!cloudData || !cloudData.saveData) {
                // No cloud save — upload local state.
                uploadSave();
                return;
            }

            const cloudTime = cloudData.timestamp || 0;
            const localTime = global.stats.current || 0;

            if (cloudTime > localTime) {
                // Cloud save is newer — prompt user.
                const cloudDate = new Date(cloudTime).toLocaleString();
                if (typeof Vue !== 'undefined' && Vue.prototype.$buefy) {
                    Vue.prototype.$buefy.dialog.confirm({
                        title: 'Cloud Save Found',
                        message: `A newer cloud save was found (from ${cloudDate}). Load it?<br><br>Choosing "Cancel" will overwrite the cloud with your local save.`,
                        confirmText: 'Load Cloud Save',
                        cancelText: 'Keep Local',
                        type: 'is-info',
                        hasIcon: true,
                        ariaModal: true,
                        onConfirm: function() {
                            window.importGame(cloudData.saveData);
                        },
                        onCancel: function() {
                            uploadSave();
                        }
                    });
                } else {
                    // Fallback if Buefy is not available.
                    if (confirm('A newer cloud save was found (from ' + cloudDate + '). Load it?')) {
                        window.importGame(cloudData.saveData);
                    } else {
                        uploadSave();
                    }
                }
            } else {
                // Local is same or newer — upload to cloud.
                uploadSave();
            }
        });
    });
}

// Return a reference to the sync state object for UI binding.
export function getSyncState() {
    return syncState;
}
