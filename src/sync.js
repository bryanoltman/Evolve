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
let hasCheckedCloud = false;

// Tracks when *this* session last successfully uploaded to the cloud.
// Persisted in localStorage so it survives page reload / crash.
let lastUploadedTimestamp = Number(localStorage.getItem('evolveLastSync')) || 0;

// Guards against concurrent reconciliation (fetch in flight).
let syncing = false;

const LAST_SYNC_KEY = 'evolveLastSync';

function isConfigured() {
    return firebaseConfig.apiKey !== "REPLACE_ME" && firebaseConfig.projectId !== "REPLACE_ME";
}

// Initialize Firebase app, auth, and Firestore. Safe to call multiple times.
// On every sign-in (returning session or fresh), reconciles with cloud automatically.
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

                // Reconcile once per sign-in session from this callback.
                // Subsequent checks happen via visibilitychange and periodic sync.
                if (!hasCheckedCloud) {
                    hasCheckedCloud = true;
                    reconcileWithCloud();
                }
            } else {
                syncState.signedIn = false;
                syncState.email = null;
                syncState.lastSync = null;
                hasCheckedCloud = false;
            }
        });

        // When the tab becomes visible, reconcile immediately.
        // Covers: resume from sleep, switching back from another tab/window.
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', function() {
                if (document.visibilityState === 'visible' && syncState.signedIn) {
                    reconcileWithCloud();
                }
            });
        }

        // Periodic reconciliation every 60s. reconcileWithCloud() gates on
        // visibility, auth, and the syncing flag, so this is safe to fire blindly.
        setInterval(reconcileWithCloud, 60000);
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
// Direct upload with no cloud check — used by manual "Upload Save" button
// and internally after reconciliation decides local is newer.
export function uploadSave() {
    if (!db || !auth || !auth.currentUser) { return; }
    if (global.race && global.race['noexport']) { return; }

    try {
        const saveData = LZString.compressToBase64(JSON.stringify(global));
        const uid = auth.currentUser.uid;
        const now = Date.now();
        db.collection('saves').doc(uid).set({
            saveData: saveData,
            timestamp: now,
            version: global['version'] || 'unknown'
        }).then(function() {
            syncState.lastSync = now;
            syncState.error = null;
            lastUploadedTimestamp = now;
            localStorage.setItem(LAST_SYNC_KEY, String(now));
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

// Core sync logic. Fetches the cloud save, compares timestamps, and
// automatically picks the newer state — no user prompt.
//   cloud newer → import cloud save (page reloads)
//   local newer → upload local save
//   no cloud    → upload local save
// Guarded by `syncing` to prevent concurrent fetches from stacking.
function reconcileWithCloud() {
    if (syncing) { return; }
    if (!db || !auth || !auth.currentUser) { return; }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') { return; }

    syncing = true;
    fetchCloudSave().then(function(cloudData) {
        if (!cloudData || !cloudData.saveData) {
            // No cloud save — upload local state.
            uploadSave();
            syncing = false;
            return;
        }

        const cloudTime = cloudData.timestamp || 0;
        if (cloudTime > lastUploadedTimestamp) {
            // Cloud is newer — load it. importGame saves to localStorage and reloads,
            // so `syncing` staying true is irrelevant (new page load resets everything).
            lastUploadedTimestamp = cloudTime;
            localStorage.setItem(LAST_SYNC_KEY, String(cloudTime));
            window.importGame(cloudData.saveData);
        } else {
            // Local is same or newer — upload to cloud.
            uploadSave();
            syncing = false;
        }
    }).catch(function(e) {
        console.warn('[sync] Cloud check failed, will retry next cycle:', e);
        syncing = false;
    });
}


// Return a reference to the sync state object for UI binding.
export function getSyncState() {
    return syncState;
}
