
// Firebase config for browser global (non-modular) usage
var firebaseConfig = {
  apiKey: "AIzaSyAcKn9D6Mmm10u4jQhgx3siuUhtgzvuMDs",
  authDomain: "invoked-image-database.firebaseapp.com",
  projectId: "invoked-image-database",
  storageBucket: "invoked-image-database.firebasestorage.app",
  messagingSenderId: "1058953171478",
  appId: "1:1058953171478:web:5a3be01fbf36167e169b37"
};

// Initialize Firebase (non-modular)
if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length === 0) {
  firebase.initializeApp(firebaseConfig);
} else if (typeof firebase !== 'undefined' && !firebase.apps) {
  firebase.initializeApp(firebaseConfig);
}

function ensureFirebaseInitialized() {
  if (typeof firebase !== 'undefined') {
    if (firebase.apps && firebase.apps.length === 0) {
      firebase.initializeApp(firebaseConfig);
    } else if (!firebase.apps) {
      firebase.initializeApp(firebaseConfig);
    }
  } else {
    console.error('Firebase SDK not loaded. Please check your script order.');
  }
}
ensureFirebaseInitialized();

const CLIENT_ID = '1058953171478-esvfacf5sqpsg1pt9e1q5kmk89jeqhq6.apps.googleusercontent.com';

// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const OAUTH2_DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/oauth2/v2/rest';

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
const SCOPES = 'https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let authModal;
let KeywordModal;
let DeleteKeywordModal;
let EditKeywordModal;
/**
 * Save user authentication state to localStorage
 */
function saveAuthState(userInfo, token) {
  localStorage.setItem('userAuthState', JSON.stringify({
    name: userInfo.name,
    picture: userInfo.picture,
    email: userInfo.email,
    token: token,
    timestamp: Date.now()
  }));
}

/**
 * Get saved authentication state from localStorage
 */
function getSavedAuthState() {
  const saved = localStorage.getItem('userAuthState');
  return saved ? JSON.parse(saved) : null;
}

/**
 * Clear stored authentication state
 */
function clearAuthState() {
  localStorage.removeItem('userAuthState');
}

/**
 * Check if user is currently authenticated
 */
function isUserAuthenticated() {
  const token = gapi.client.getToken();
  return token !== null;
}

/**
 * Update modal visibility based on authentication status
 */
function updateModalVisibility() {
  if (!authModal) {
    authModal = new bootstrap.Modal(document.getElementById('modalChoice'), {
      backdrop: 'static',
      keyboard: false
    });
  }

  if (isUserAuthenticated()) {
    authModal.hide();
    // Restore user info from saved state if available
    const savedState = getSavedAuthState();
    if (savedState) {
      document.getElementById("pfp").src = savedState.picture;
      document.getElementById("username").textContent = savedState.name;
    }
  } else {
    authModal.show();
  }
}

/**
 * Callback after api.js is loaded.
 */
function gapiLoaded() {
  gapi.load('client', initializeGapiClient);
}

/**
 * Callback after the API client is loaded. Loads the
 * discovery doc to initialize the API.
 */
async function initializeGapiClient() {
  await gapi.client.init({
    discoveryDocs: [DISCOVERY_DOC, OAUTH2_DISCOVERY_DOC],
  });
  gapiInited = true;

  // Restore saved token if available
  const savedState = getSavedAuthState();
  if (savedState && savedState.token) {
    gapi.client.setToken(savedState.token);

    // Restore Firebase Auth session if possible
    if (savedState.token.access_token) {
      var credential = firebase.auth.GoogleAuthProvider.credential(null, savedState.token.access_token);
      firebase.auth().signInWithCredential(credential)
        .then((userCredential) => {
          console.log('Firebase Auth session restored after reload.');
        })
        .catch((error) => {
          console.error('Failed to restore Firebase Auth session:', error);
        });
    }
  }

  updateModalVisibility();
}

/**
 * Callback after Google Identity Services are loaded.
 */
function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: '', // defined later
  });
  gisInited = true;
}



/**
 *  Sign in the user upon button click.
 */
function handleAuthClick() {

  tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) {
      throw (resp);
    }
    console.log('Access Token: ' + resp.access_token);

    // Sign in to Firebase Auth with Google access token
    var credential = firebase.auth.GoogleAuthProvider.credential(null, resp.access_token);
    firebase.auth().signInWithCredential(credential)
      .then(async (userCredential) => {
        // Get and log user info
        const userInfo = await gapi.client.oauth2.userinfo.get();
        const userDetails = userInfo.result;
        const token = gapi.client.getToken();

        // Save user state to localStorage
        saveAuthState(userDetails, token);

        document.getElementById("pfp").src = userDetails.picture;
        document.getElementById("username").textContent = userDetails.name;
        updateModalVisibility();
        await listFiles();

        // Only call Firestore after Firebase Auth sign-in is confirmed
        if (firebase.auth().currentUser) {
          listKeywords();
        } else {
          console.warn('User not authenticated with Firebase, skipping Firestore access.');
        }
      })
      .catch((error) => {
        console.error('Firebase Auth error:', error);
        alert('Failed to sign in to Firebase. Some features may not work.');
      });
  };

  if (gapi.client.getToken() === null) {
    // Prompt the user to select a Google Account and ask for consent to share their data
    // when establishing a new session.
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    // Skip display of account chooser and consent dialog for an existing session.
    tokenClient.requestAccessToken({ prompt: '' });
  }
}

/**
 *  Sign out the user upon button click.
 */
function handleSignoutClick() {
  const token = gapi.client.getToken();
  if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token, () => {
      // Clear the token after revocation
      gapi.client.setToken(null);
      clearAuthState();
      updateModalVisibility();
    });
  }
}

/**
 * Print metadata for first 10 files.
 */
async function listFiles() {
  let response;
  try {
    response = await gapi.client.drive.files.list({
      'pageSize': 10,
      'fields': 'files(id, name)',
    });
  } catch (err) {
    return;
  }
  const files = response.result.files;
  if (!files || files.length == 0) {
    return;
  }
  // Flatten to string to display
  const output = files.reduce(
    (str, file) => `${str}${file.name} (${file.id})\n`,
    'Files:\n');
}

//list keywords from firestore
function listKeywords() {
  ensureFirebaseInitialized();
  if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
    document.getElementById("keywords").innerHTML = ` 
                    <div onclick="openKeywordModal()" class="list-group-item list-group-item" aria-current="true" id="add-keyword"
                        style="text-align: center; cursor: pointer;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="currentColor"
                            class="bi bi-plus-square" viewBox="0 0 16 16">
                            <path
                                d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4" />
                        </svg>
                    </div>`;
    const db = firebase.firestore();
    db.collection("Keywords").get().then((querySnapshot) => {
      [...querySnapshot.docs].reverse().forEach((doc) => {
        document.getElementById("keywords").innerHTML = `
          <div class="list-group-item list-group-item" aria-current="true">
            <div class="d-flex w-100 justify-content-between">
              <h5 class="mb-1"><b>${doc.data().Name}</b></h5>
                <svg onclick="openEditKeywordModal('${JSON.stringify(doc.id).split('"')[1]}')" class="edit" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pen" viewBox="0 0 16 16">
                  <path d="m13.498.795.149-.149a1.207 1.207 0 1 1 1.707 1.708l-.149.148a1.5 1.5 0 0 1-.059 2.059L4.854 14.854a.5.5 0 0 1-.233.131l-4 1a.5.5 0 0 1-.606-.606l1-4a.5.5 0 0 1 .131-.232l9.642-9.642a.5.5 0 0 0-.642.056L6.854 4.854a.5.5 0 1 1-.708-.708L9.44.854A1.5 1.5 0 0 1 11.5.796a1.5 1.5 0 0 1 1.998-.001m-.644.766a.5.5 0 0 0-.707 0L1.95 11.756l-.764 3.057 3.057-.764L14.44 3.854a.5.5 0 0 0 0-.708z" />
                </svg>
            </div>
            <p class="mb-1">${doc.data().Effect}</p>
            <div class="d-flex w-100 justify-content-between">            
              <small style="font-size: 12px">ID: ${JSON.stringify(doc.id).split('"')[1]}</small>  
              <svg onclick="openDeleteKeywordModal('${JSON.stringify(doc.id).split('"')[1]}')" class="delete" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash3" viewBox="0 0 16 16">
                <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47M8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5"/>
              </svg>
            </div>
          </div>`
          + document.getElementById("keywords").innerHTML
      });
    });
  } else {
    console.error('Cannot access Firestore: Firebase is not initialized.');
  }

}

function openKeywordModal() {
  if (!KeywordModal) {
    KeywordModal = new bootstrap.Modal(document.getElementById('add-keyword-modal'), {
      backdrop: 'static',
      keyboard: false
    });
  }
  KeywordModal.show();
}

function closeKeywordModal() {
  if (KeywordModal) {
    document.getElementById("KeywordName").value = "";
    document.getElementById("KeywordEffect").value = "";
    KeywordModal.hide();
  }
}

function addKeyword(event) {
  event.preventDefault();
  ensureFirebaseInitialized();
  const keywordName = document.getElementById("KeywordName").value;
  const keywordEffect = document.getElementById("KeywordEffect").value;

  if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
    const db = firebase.firestore();
    db.collection("Keywords").add({
      Name: keywordName,
      Effect: keywordEffect
    })
      .then((docRef) => {
        console.log("Keyword added with ID: ", docRef.id);
        closeKeywordModal();

        listKeywords();
      })
      .catch((error) => {
        console.error("Error adding keyword: ", error);
      });
  } else {
    console.error('Cannot add keyword: Firebase is not initialized.');
  }
}

function openDeleteKeywordModal(keywordId) {
  ensureFirebaseInitialized();
  if (!DeleteKeywordModal) {
    DeleteKeywordModal = new bootstrap.Modal(document.getElementById('delete-keyword-modal'), {
      backdrop: 'static',
      keyboard: false
    });
  }
  DeleteKeywordModal.show();
  document.getElementById('delete-keyword-modal').addEventListener('shown.bs.modal', function () {
    document.getElementById('confirm-delete-btn').onclick = () => deleteKeyword(keywordId);
  });
}
function deleteKeyword(keywordId) {
  ensureFirebaseInitialized();
  if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
    const db = firebase.firestore();
    db.collection("Keywords").doc(keywordId).delete()
      .then(() => {
        console.log("Keyword successfully deleted!");
        closeDeleteKeywordModal();

        listKeywords();
      })
      .catch((error) => {
        console.error("Error removing keyword: ", error);
      });
  } else {
    console.error('Cannot delete keyword: Firebase is not initialized.');
  }
}

function closeDeleteKeywordModal() {
  if (DeleteKeywordModal) {
    DeleteKeywordModal.hide();
  }
}

function openEditKeywordModal(keywordId) {
  if (!EditKeywordModal) {
    EditKeywordModal = new bootstrap.Modal(document.getElementById('edit-keyword-modal'), {
      backdrop: 'static',
      keyboard: false
    });
  }
  EditKeywordModal.show();
  // Remove previous submit listeners to prevent duplicates
  const editForm = document.getElementById('edit-keyword-form');
  const newForm = editForm.cloneNode(true);
  editForm.parentNode.replaceChild(newForm, editForm);
  // Fetch and populate the keyword data into the edit modal
  const db = firebase.firestore();
  db.collection("Keywords").doc(keywordId).get().then((doc) => {
    if (doc.exists) {
      document.getElementById("EditKeywordName").value = doc.data().Name;
      document.getElementById("EditKeywordEffect").value = doc.data().Effect;
      document.getElementById('edit-keyword-form').setAttribute('data-keyword-id', keywordId);
    } else {
      console.log("No such document!");
    }
  }).catch((error) => {
    console.error("Error getting document:", error);
  });
}

function editKeyword(event) {
  event.preventDefault();
  ensureFirebaseInitialized();
  const keywordId = document.getElementById('edit-keyword-form').getAttribute('data-keyword-id');
  const updatedName = document.getElementById("EditKeywordName").value;
  const updatedEffect = document.getElementById("EditKeywordEffect").value;

  if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
    const db = firebase.firestore();
    db.collection("Keywords").doc(keywordId).update({
      Name: updatedName,
      Effect: updatedEffect
    })
      .then(() => {
        console.log("Keyword updated with ID: ", keywordId);
        closeEditKeywordModal();
        // Optionally, refresh the keyword list

        listKeywords();
      })
      .catch((error) => {
        console.error("Error updating keyword: ", error);
      });
  } else {
    console.error('Cannot update keyword: Firebase is not initialized.');
  }
}

function closeEditKeywordModal() {
  if (EditKeywordModal) {
    EditKeywordModal.hide();
  }
}