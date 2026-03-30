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

// True while a conflict dialog is showing — prevents stacked dialogs and blind uploads.
let blockUploads = false;

const LAST_SYNC_KEY = 'evolveLastSync';

function isConfigured() {
    return firebaseConfig.apiKey !== "REPLACE_ME" && firebaseConfig.projectId !== "REPLACE_ME";
}

// Initialize Firebase app, auth, and Firestore. Safe to call multiple times.
// On every sign-in (returning session or fresh), checks cloud save automatically.
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

                // Check cloud save once per sign-in session.
                if (!hasCheckedCloud) {
                    hasCheckedCloud = true;
                    performCloudCheck();
                }
            } else {
                syncState.signedIn = false;
                syncState.email = null;
                syncState.lastSync = null;
                hasCheckedCloud = false;
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
// Direct upload with no conflict check — used by manual "Upload Save" button
// and after the user has resolved a conflict (chose "Keep Local" or initial upload).
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

// Show a conflict dialog letting the user choose between cloud and local saves.
// Shared by performCloudCheck (on sign-in) and checkCloudBeforeUpload (periodic).
function showConflictDialog(cloudData) {
    const cloudTime = cloudData.timestamp || 0;
    const cloudDate = new Date(cloudTime).toLocaleString();

    function onConfirm() {
        // User chose cloud — persist cloud timestamp so the post-reload check
        // sees cloud timestamp <= lastUploadedTimestamp and doesn't re-prompt.
        lastUploadedTimestamp = cloudTime;
        localStorage.setItem(LAST_SYNC_KEY, String(cloudTime));
        blockUploads = false;
        window.importGame(cloudData.saveData);
    }

    function onCancel() {
        // User explicitly chose local — overwrite cloud.
        blockUploads = false;
        uploadSave();
    }

    if (typeof Vue !== 'undefined' && Vue.prototype.$buefy) {
        Vue.prototype.$buefy.dialog.confirm({
            title: 'Cloud Save Found',
            message: `A newer cloud save was found (from ${cloudDate}). Load it?<br><br>Choosing "Keep Local" will overwrite the cloud with your local save.`,
            confirmText: 'Load Cloud Save',
            cancelText: 'Keep Local',
            type: 'is-info',
            hasIcon: true,
            ariaModal: true,
            onConfirm: onConfirm,
            onCancel: onCancel
        });
    } else {
        // Fallback if Buefy is not available.
        if (confirm('A newer cloud save was found (from ' + cloudDate + '). Load it? Choosing OK loads the cloud save. Choosing Cancel keeps your local save and overwrites the cloud.')) {
            onConfirm();
        } else {
            onCancel();
        }
    }
}

// Fetch cloud save, compare timestamps, and either load cloud or upload local.
// Called automatically on every sign-in via onAuthStateChanged.
// If the tab is hidden at sign-in time, defers the check until the tab becomes visible.
function performCloudCheck() {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        // Tab is in the background (e.g., restored session in a background tab).
        // Defer the cloud check until the user actually looks at this tab.
        function onVisible() {
            if (document.visibilityState === 'visible') {
                document.removeEventListener('visibilitychange', onVisible);
                performCloudCheckNow();
            }
        }
        document.addEventListener('visibilitychange', onVisible);
        return;
    }
    performCloudCheckNow();
}

function performCloudCheckNow() {
    fetchCloudSave().then(function(cloudData) {
        if (!cloudData || !cloudData.saveData) {
            // No cloud save — upload local state.
            uploadSave();
            return;
        }

        const cloudTime = cloudData.timestamp || 0;

        if (cloudTime > lastUploadedTimestamp) {
            // Cloud save is newer than our last upload — prompt user.
            blockUploads = true;
            showConflictDialog(cloudData);
        } else {
            // Local is same or newer — upload to cloud.
            uploadSave();
        }
    });
}

// Called from longLoop periodic sync. Replaces direct uploadSave() call.
// Checks whether another session uploaded since we last did. If so, prompts
// the user instead of blindly overwriting.
export function syncUpload() {
    if (blockUploads) { return; }
    if (!db || !auth || !auth.currentUser) { return; }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') { return; }

    checkCloudBeforeUpload();
}

// Fetch cloud save and compare its timestamp to our last upload.
// If another session uploaded since we last did, show a conflict dialog.
// Otherwise, proceed with a normal upload.
function checkCloudBeforeUpload() {
    fetchCloudSave().then(function(cloudData) {
        if (!cloudData || !cloudData.saveData) {
            // No cloud save exists — safe to upload.
            uploadSave();
            return;
        }

        const cloudTime = cloudData.timestamp || 0;
        if (cloudTime > lastUploadedTimestamp) {
            // Another session uploaded since we last did — conflict.
            blockUploads = true;
            showConflictDialog(cloudData);
        } else {
            uploadSave();
        }
    }).catch(function(e) {
        // Network error — skip this cycle, try next time.
        console.warn('[sync] Cloud check failed, will retry next cycle:', e);
    });
}

// Return a reference to the sync state object for UI binding.
export function getSyncState() {
    return syncState;
}
