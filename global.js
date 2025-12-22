
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
      // Set Firebase Auth to persist sessions across browser sessions
      firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .catch((error) => {
          console.error('Error setting persistence:', error);
        });
    } else if (!firebase.apps) {
      firebase.initializeApp(firebaseConfig);
      firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .catch((error) => {
          console.error('Error setting persistence:', error);
        });
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
const SCOPES = 'https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let tokenExpiryTimeoutId = null;
let authModal;
let KeywordModal;
let DeleteKeywordModal;
let EditKeywordModal;
let CardModal;
let DeleteCardModal;
const db = firebase.firestore();
/**
 * Save user authentication state to localStorage
 */
function saveAuthState(userInfo, token, expiresInSeconds) {
  const now = Date.now();
  let expiresAt = null;
  if (typeof expiresInSeconds === 'number' && !isNaN(expiresInSeconds)) {
    expiresAt = now + expiresInSeconds * 1000;
  } else if (token && typeof token.expires_in === 'number') {
    expiresAt = now + token.expires_in * 1000;
  } else {
    // Fallback to 1 hour if not provided by GIS
    expiresAt = now + 3600000;
  }

  localStorage.setItem('userAuthState', JSON.stringify({
    name: userInfo.name,
    picture: userInfo.picture,
    email: userInfo.email,
    token: token,
    timestamp: now,
    expiresAt: expiresAt
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

function getTokenExpiresAt() {
  const saved = getSavedAuthState();
  if (!saved) return null;
  if (typeof saved.expiresAt === 'number') return saved.expiresAt;
  if (typeof saved.timestamp === 'number') return saved.timestamp + 3600000;
  return null;
}

function onTokenExpired() {
  console.log('Detected expired Google token; signing out to sync Firebase.');
  // Avoid multiple triggers
  if (tokenExpiryTimeoutId) {
    clearTimeout(tokenExpiryTimeoutId);
    tokenExpiryTimeoutId = null;
  }
  if (firebase && firebase.auth && firebase.auth().currentUser) {
    handleSignoutClick();
  } else {
    clearAuthState();
    updateModalVisibility();
  }
}

function scheduleTokenExpiryCheck() {
  const expiresAt = getTokenExpiresAt();
  if (!expiresAt) return;
  const msRemaining = expiresAt - Date.now();
  if (tokenExpiryTimeoutId) {
    clearTimeout(tokenExpiryTimeoutId);
    tokenExpiryTimeoutId = null;
  }
  if (msRemaining <= 0) {
    onTokenExpired();
    return;
  }
  // Small buffer to ensure the token is considered expired server-side
  tokenExpiryTimeoutId = setTimeout(onTokenExpired, msRemaining + 1000);
}

/**
 * Check if user is currently authenticated
 */
function isUserAuthenticated() {
  // Check Firebase Auth state first (more reliable)
  if (firebase.auth().currentUser) {
    return true;
  }
  // Fallback to GAPI token check
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

  // Wait for Firebase Auth to check existing session
  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      console.log('User already signed in:', user.email);

      // Restore user info display from saved state or Firebase
      const savedState = getSavedAuthState();
      if (savedState) {
        document.getElementById("pfp").src = savedState.picture;
        document.getElementById("username").textContent = savedState.name;

        // Restore GAPI token if not expired (for Drive API calls)
        const tokenAge = Date.now() - savedState.timestamp;
        if (savedState.token && tokenAge < 3600000) {
          gapi.client.setToken(savedState.token);
        }
      } else if (user.photoURL && user.displayName) {
        // Use Firebase user info if localStorage was cleared
        document.getElementById("pfp").src = user.photoURL;
        document.getElementById("username").textContent = user.displayName;
      }

      // If saved Google token is already expired, sign out of Firebase to match
      const expiresAt = getTokenExpiresAt();
      if (expiresAt && Date.now() >= expiresAt) {
        console.log('Saved Google token expired on load; signing out.');
        handleSignoutClick();
        return;
      }

      // Schedule auto sign-out when the token expires
      scheduleTokenExpiryCheck();

      updateModalVisibility();
    } else {
      console.log('No user signed in.');
      clearAuthState();
      updateModalVisibility();
    }
  });
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
        saveAuthState(userDetails, token, resp.expires_in);

        // Schedule sign-out when token expires
        scheduleTokenExpiryCheck();

        document.getElementById("pfp").src = userDetails.picture;
        document.getElementById("username").textContent = userDetails.name;
        updateModalVisibility();
        await listFiles();

        // Only call Firestore after Firebase Auth sign-in is confirmed
        if (firebase.auth().currentUser) {
          console.log('User authenticated with Firebase. Accessing Firestore...');
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
  // Clear any pending expiry timer
  if (tokenExpiryTimeoutId) {
    clearTimeout(tokenExpiryTimeoutId);
    tokenExpiryTimeoutId = null;
  }
  // Sign out from Firebase Auth
  firebase.auth().signOut().then(() => {
    console.log('User signed out from Firebase.');

    // Revoke Google OAuth token
    const token = gapi.client.getToken();
    if (token !== null) {
      google.accounts.oauth2.revoke(token.access_token, () => {
        gapi.client.setToken(null);
      });
    }

    clearAuthState();
    updateModalVisibility();
  }).catch((error) => {
    console.error('Error signing out:', error);
  });
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
    try {
      const status = err?.status || err?.result?.error?.code;
      if (status === 401 || status === 403) {
        onTokenExpired();
      }
    } catch (e) { /* noop */ }
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

async function addCard(event) {
  event.preventDefault();
  
  document.getElementById("submitNewCard").disabled = true;
  document.getElementById("submitNewCard").classList.add("btn-secondary");
  if (!document.getElementById("add-card-form").checkValidity()) {
    document.getElementById("add-card-form").reportValidity();
    console.log("Form invalid");
    document.getElementById("submitNewCard").classList.remove("btn-secondary");
    document.getElementById("submitNewCard").disabled = false;
    return;
  }
  console.log(document.getElementById("add-card-form").checkValidity());
  // Check if user is authenticated
  if (!isUserAuthenticated()) {
    alert('You must be signed in to add a card.');
    document.getElementById("submitNewCard").classList.remove("btn-secondary");

    document.getElementById("submitNewCard").disabled = false;
    return;
  }

  const fileInput = document.getElementById('CardImage');
  const file = fileInput.files[0];
  if (!file) {

    db.collection("Cards").add({
      Name: document.getElementById("CardName").value,
      Effect: document.getElementById("CardEffect").value,
      ImageFileID: null,
      Type: document.getElementById("CardType").value,
      Roles: Array.from(document.getElementById('card-fields-list').children).map(element => element.children[2].value),
      ChipCost: document.getElementById("CardChipCost").value,
      BurnCost: document.getElementById("CardBurnCost").value,
      SacrificeCost: document.getElementById("CardSacrificeCost").value,
      Defence: document.getElementById("CardDefence").value,
      Attack: document.getElementById("CardAttack").value
    })
      .then((docRef) => {
        console.log("Card added with ID: ", docRef.id);
        document.getElementById("submitNewCard").classList.remove("btn-secondary");
        document.getElementById("submitNewCard").disabled = false;
        resetAddCardForm();
      })
      .catch((error) => {
        document.getElementById("submitNewCard").disabled = false;
        console.error("Error adding card: ", error);
      });
    closeCardModal();
    return;
  }

  try {
    const folderId = '1GACgBU0no9gT-yc4yZXm-UqAcjSeqX-Y';
    let fileID = null;
    // Create metadata
    const metadata = {
      name: file.name,
      mimeType: file.type,
      parents: [folderId]
    };

    // Create form data for multipart upload
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    // Get the access token
    const token = getSavedAuthState().token;
    if (!token || !token.access_token) {
      alert('Authentication token is missing. Please sign in again.');
      document.getElementById("submitNewCard").classList.remove("btn-secondary");
      document.getElementById("submitNewCard").disabled = false;
      return;
    }

    // Upload using fetch API with multipart/related
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.access_token}`
      },
      body: form
    });

    if (response.ok) {
      const result = await response.json();
      console.log('File uploaded successfully:', result.webViewLink);
      fileID = result.id;
      
      db.collection("Cards").add({
        Name: document.getElementById("CardName").value,
        Effect: document.getElementById("CardEffect").value,
        ImageFileID: fileID,
        Type: document.getElementById("CardType").value,
        Roles: Array.from(document.getElementById('card-fields-list').children).map(element => element.children[2].value),
        ChipCost: document.getElementById("CardChipCost").value,
        BurnCost: document.getElementById("CardBurnCost").value,
        SacrificeCost: document.getElementById("CardSacrificeCost").value,
        Defence: document.getElementById("CardDefence").value,
        Attack: document.getElementById("CardAttack").value
      })
        .then((docRef) => {
          console.log("Card added with ID: ", docRef.id);
          document.getElementById("submitNewCard").classList.remove("btn-secondary");
          document.getElementById("submitNewCard").disabled = false;
          resetAddCardForm();
        })
        .catch((error) => {
          document.getElementById("submitNewCard").disabled = false;
          console.error("Error adding card: ", error);
        });
    } else {
      const error = await response.json();
      console.error('Upload failed:', error);
      document.getElementById("submitNewCard").classList.remove("btn-secondary");
      document.getElementById("submitNewCard").disabled = false;
    }
  } catch (error) {
    console.error('Error uploading file:', error);
    document.getElementById("submitNewCard").classList.remove("btn-secondary");
    document.getElementById("submitNewCard").disabled = false;
  }

}

function resetAddCardForm() {
  listCards();
  document.getElementById("add-card-form").reset();
  document.getElementById("card-fields-list").innerHTML = "";
}

function openCardModal() {
  if (!CardModal) {
    CardModal = new bootstrap.Modal(document.getElementById('add-card-modal'), {
      backdrop: 'static',
      keyboard: false
    });
  }
  CardModal.show();
}

function closeCardModal() {
  if (CardModal) {
    resetAddCardForm();
    CardModal.hide();
  }
}

function listCards() {
  document.getElementById("cards-container").innerHTML = "";
  

  db.collection("Cards").get().then((querySnapshot) => {
    querySnapshot.forEach((doc) => {
      let link = "./BlankCard.png";
      if (doc.data().ImageFileID != null) {
        link = `https://drive.google.com/thumbnail?id=${doc.data().ImageFileID}&sz=w750-h1050`;
      }
      document.getElementById("cards-container").innerHTML += `
      <div class="col-12 col-md-6 col-lg-4">
                            <div class="card h-100">
                                <img src="${link}" class="card-img-top playing-card-ratio" alt="Card image cap">
                                <div class="card-body">
                                    <h5 class="card-title">${doc.data().Name}</h5>
                                    <dl>
                                        <dt>Card type</dt>
                                        <dd>${doc.data().Type}</dd>
                                        <dt>Roles</dt>
                                        <dd>${doc.data().Roles.join(', ')}</dd>
                                        <dt>Chips cost</dt>
                                        <dd>${doc.data().ChipCost}</dd>
                                        <dt>Burn cost</dt>
                                        <dd>${doc.data().BurnCost}</dd>
                                        <dt>Sacrifice cost</dt>
                                        <dd>${doc.data().SacrificeCost}</dd>
                                        <dt>Defence</dt>
                                        <dd>${doc.data().Defence}</dd>
                                        <dt>Attack</dt>
                                        <dd>${doc.data().Attack}</dd>
                                        <dt>Effect</dt>
                                        <dd>${doc.data().Effect}</dd>
                                    </dl>

                                    <p class="card-text">
                                      <small class="text-body-secondary">ID: ${doc.id}</small> 
                                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" class="delete" fill="currentColor" class="bi bi-trash3" viewBox="0 0 16 16" style="float: right; cursor: pointer; margin-top: 4px;" onclick='openDeleteCardModal(${JSON.stringify(doc.id)})'>
                                        <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5M11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1zm1.958 1-.846 10.58a1 1 0 0 1-.997.92h-6.23a1 1 0 0 1-.997-.92L3.042 3.5zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.53Zm5.058 0a.5.5 0 0 1 .47.53l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .528-.47M8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5"/>
                                      </svg>
                                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" class="edit" fill="currentColor" class="bi bi-pen" viewBox="0 0 16 16" style="float: right; cursor: pointer; margin-right: 16px; margin-top: 4px;" onclick='openEditCardModal(${JSON.stringify(doc.id)})'>
                                        <path d="m13.498.795.149-.149a1.207 1.207 0 1 1 1.707 1.708l-.149.148a1.5 1.5 0 0 1-.059 2.059L4.854 14.854a.5.5 0 0 1-.233.131l-4 1a.5.5 0 0 1-.606-.606l1-4a.5.5 0 0 1 .131-.232l9.642-9.642a.5.5 0 0 0-.642.056L6.854 4.854a.5.5 0 1 1-.708-.708L9.44.854A1.5 1.5 0 0 1 11.5.796a1.5 1.5 0 0 1 1.998-.001m-.644.766a.5.5 0 0 0-.707 0L1.95 11.756l-.764 3.057 3.057-.764L14.44 3.854a.5.5 0 0 0 0-.708z"/>
                                      </svg>
                                    </p>
                                </div>
                            </div>
                        </div>
      `
    });
  });
}
function openDeleteCardModal(cardId) {
  ensureFirebaseInitialized();
  if (!DeleteCardModal) {
    DeleteCardModal = new bootstrap.Modal(document.getElementById('delete-card-modal'), {
      backdrop: 'static',
      keyboard: false
    });
  }
  DeleteCardModal.show();
  document.getElementById('delete-card-modal').addEventListener('shown.bs.modal', function () {
    document.getElementById('confirm-delete-btn').onclick = () => deleteCard(cardId);
  });
}
function deleteCard(cardId) {
  ensureFirebaseInitialized();
  if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {

    db.collection("Cards").doc(cardId).delete()
      .then(() => {
        console.log("Card successfully deleted!");
        closeDeleteCardModal();

        listCards();
      })
      .catch((error) => {
        console.error("Error removing card: ", error);
      });
  } else {
    console.error('Cannot delete card: Firebase is not initialized.');
  }
}

function closeDeleteCardModal() {
  if (DeleteCardModal) {
    DeleteCardModal.hide();
  }
}