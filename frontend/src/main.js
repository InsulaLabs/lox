import './style.css';
import './app.css';
import * as App from '../wailsjs/go/main/App';
import { EventsOn } from '../wailsjs/runtime/runtime';

let currentTab = 'values';
const pageSize = 50;

const state = {
    values: { 
        keys: [], 
        searchTerm: '', 
        selectedKey: null, 
        selectedValue: null,
        currentPage: 0,
        selectedForDeletion: new Set(),
        lastCheckedIndex: -1
    },
    cache: { 
        keys: [], 
        searchTerm: '', 
        selectedKey: null, 
        selectedValue: null,
        currentPage: 0,
        selectedForDeletion: new Set(),
        lastCheckedIndex: -1
    },
    blobs: { 
        keys: [], 
        searchTerm: '', 
        selectedKey: null, 
        selectedValue: null,
        currentPage: 0,
        selectedForDeletion: new Set(),
        lastCheckedIndex: -1
    },
    events: {
        subscriptions: new Set(),
        messages: [],
        maxMessages: 100
    }
};

let editMode = false;
let insertMode = false;
let confirmDialog = null;

function renderApp() {
    document.querySelector('#app').innerHTML = `
        <div class="container">
            <div class="tabs">
                <button class="tab ${currentTab === 'values' ? 'active' : ''}" onclick="switchTab('values')">Values</button>
                <button class="tab ${currentTab === 'cache' ? 'active' : ''}" onclick="switchTab('cache')">Cache</button>
                <button class="tab ${currentTab === 'blobs' ? 'active' : ''}" onclick="switchTab('blobs')">Blobs</button>
                <button class="tab ${currentTab === 'events' ? 'active' : ''}" onclick="switchTab('events')">Events</button>
            </div>
            
            <div class="tab-content">
                ${currentTab !== 'events' ? `
                    <div class="toolbar">
                        <div class="search-section">
                            <input 
                                type="text" 
                                id="search-input" 
                                class="search-input" 
                                placeholder="Enter prefix to search..." 
                                value="${state[currentTab].searchTerm}"
                                onkeyup="handleSearch(event)"
                            />
                            <button class="search-btn" onclick="performSearch()">Search</button>
                        </div>
                        <div class="action-buttons">
                            <button class="action-btn insert-btn" onclick="showInsertDialog()">
                                <span class="icon">+</span> Insert New
                            </button>
                            <button 
                                class="action-btn delete-selected-btn ${state[currentTab].selectedForDeletion.size === 0 ? 'disabled' : ''}" 
                                onclick="deleteSelected()"
                                ${state[currentTab].selectedForDeletion.size === 0 ? 'disabled' : ''}
                            >
                                <span class="icon">🗑</span> Delete Selected ${state[currentTab].selectedForDeletion.size > 0 ? `(${state[currentTab].selectedForDeletion.size})` : ''}
                            </button>
                        </div>
                    </div>
                    
                    <div class="results-container">
                        <div class="key-list" id="key-list">
                            ${renderKeyList()}
                        </div>
                        <div class="key-details" id="key-details">
                            ${renderDetails()}
                        </div>
                    </div>
                ` : renderEventsTab()}
            </div>
        </div>
        ${renderModals()}
    `;
}

function renderKeyList() {
    const keys = state[currentTab].keys;
    const selectedKey = state[currentTab].selectedKey;
    const selectedForDeletion = state[currentTab].selectedForDeletion;
    
    if (keys.length === 0) {
        return '<div class="no-results">No keys found. Try searching with a prefix.</div>';
    }
    
    return `
        <div class="key-items">
            ${keys.map((key, index) => `
                <div class="key-item-wrapper">
                    <input 
                        type="checkbox" 
                        class="key-checkbox" 
                        data-index="${index}"
                        data-key="${escapeHtml(key)}"
                        ${selectedForDeletion.has(key) ? 'checked' : ''}
                    />
                    <div class="key-item ${key === selectedKey ? 'selected' : ''}" onclick="selectKey('${escapeHtml(key)}')">
                        ${escapeHtml(key)}
                    </div>
                </div>
            `).join('')}
        </div>
        ${keys.length >= pageSize * (state[currentTab].currentPage + 1) ? `
            <div class="pagination">
                <button onclick="loadMore()">Load More</button>
            </div>
        ` : ''}
    `;
}

function renderDetails() {
    const tabState = state[currentTab];
    
    if (!tabState.selectedKey) {
        return '<div class="placeholder">Select a key to view details</div>';
    }
    
    if (tabState.selectedValue === null || tabState.selectedValue === undefined) {
        return '<div class="placeholder">Select a key to view details</div>';
    }
    
    if (editMode) {
        return renderEditMode(tabState.selectedKey, tabState.selectedValue);
    }
    
    if (currentTab === 'blobs') {
        return renderBlobDetails(tabState.selectedKey, tabState.selectedValue);
    } else {
        return renderValueDetails(tabState.selectedKey, tabState.selectedValue);
    }
}

function renderEditMode(key, value) {
    return `
        <div class="detail-header">
            <h3>${escapeHtml(key)}</h3>
            <div class="edit-actions">
                <button class="save-btn" onclick="saveValue()">Save</button>
                <button class="cancel-btn" onclick="cancelEdit()">Cancel</button>
            </div>
        </div>
        <div class="detail-content">
            <textarea 
                id="edit-value" 
                class="edit-textarea" 
                placeholder="Enter value..."
            >${escapeHtml(value)}</textarea>
        </div>
    `;
}

function renderValueDetails(key, value) {
    const displayValue = value === '' ? '<span class="empty-value">(empty string)</span>' : escapeHtml(value);
    return `
        <div class="detail-header">
            <h3>${escapeHtml(key)}</h3>
            <div class="detail-actions">
                <button class="edit-btn" onclick="enterEditMode()">Edit</button>
                <button class="delete-btn" onclick="deleteKey('${escapeHtml(key)}')">Delete</button>
            </div>
        </div>
        <div class="detail-content">
            <div class="value-display">${displayValue}</div>
        </div>
    `;
}

function renderBlobDetails(key, blobInfo) {
    const formatSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    
    return `
        <div class="detail-header">
            <h3>${escapeHtml(key)}</h3>
            <button class="delete-btn" onclick="deleteKey('${escapeHtml(key)}')">Delete</button>
        </div>
        <div class="detail-content">
            <div class="blob-info">
                <div class="blob-metadata">
                    <p><strong>File Size:</strong> ${formatSize(blobInfo.size)}</p>
                    <p><strong>Raw Size:</strong> ${blobInfo.size.toLocaleString()} bytes</p>
                </div>
                <div class="blob-notice">
                    <p class="help-text">Binary data preview not available</p>
                </div>
            </div>
        </div>
    `;
}

function renderModals() {
    const insertModal = currentTab === 'blobs' ? `
        <div id="insert-modal" class="modal" style="display: none;">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Upload Blob</h2>
                    <button class="close-btn" onclick="closeInsertDialog()">×</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Key:</label>
                        <input type="text" id="insert-key" class="form-input" placeholder="Enter key..." />
                    </div>
                    <div class="form-group">
                        <p class="help-text">After entering the key, click "Select File" to choose a file to upload.</p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="save-btn" onclick="insertNewValue()">Select File</button>
                    <button class="cancel-btn" onclick="closeInsertDialog()">Cancel</button>
                </div>
            </div>
        </div>
    ` : `
        <div id="insert-modal" class="modal" style="display: none;">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Insert New ${currentTab === 'values' ? 'Value' : 'Cache Entry'}</h2>
                    <button class="close-btn" onclick="closeInsertDialog()">×</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Key:</label>
                        <input type="text" id="insert-key" class="form-input" placeholder="Enter key..." />
                    </div>
                    <div class="form-group">
                        <label>Value:</label>
                        <textarea id="insert-value" class="form-textarea" placeholder="Enter value..." rows="5"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="save-btn" onclick="insertNewValue()">Insert</button>
                    <button class="cancel-btn" onclick="closeInsertDialog()">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    return `
        ${insertModal}
        <div id="confirm-dialog" class="modal" style="display: none;">
            <div class="modal-content confirm-dialog">
                <div class="modal-header">
                    <h2 id="confirm-title">Confirm Action</h2>
                </div>
                <div class="modal-body">
                    <p id="confirm-message">Are you sure?</p>
                </div>
                <div class="modal-footer">
                    <button class="confirm-btn" id="confirm-yes">Confirm</button>
                    <button class="cancel-btn" id="confirm-no">Cancel</button>
                </div>
            </div>
        </div>
    `;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showConfirm(title, message) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('confirm-dialog');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const yesBtn = document.getElementById('confirm-yes');
        const noBtn = document.getElementById('confirm-no');
        
        titleEl.textContent = title;
        messageEl.textContent = message;
        dialog.style.display = 'flex';
        
        const cleanup = () => {
            dialog.style.display = 'none';
            yesBtn.removeEventListener('click', handleYes);
            noBtn.removeEventListener('click', handleNo);
            document.removeEventListener('keydown', handleEscape);
        };
        
        const handleYes = () => {
            cleanup();
            resolve(true);
        };
        
        const handleNo = () => {
            cleanup();
            resolve(false);
        };
        
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                resolve(false);
            }
        };
        
        yesBtn.addEventListener('click', handleYes);
        noBtn.addEventListener('click', handleNo);
        document.addEventListener('keydown', handleEscape);
        
        // Focus the confirm button
        setTimeout(() => noBtn.focus(), 0);
    });
}

window.switchTab = function(tab) {
    currentTab = tab;
    editMode = false;
    insertMode = false;
    renderApp();
};

window.handleSearch = function(event) {
    if (event.key === 'Enter') {
        performSearch();
    }
};

window.performSearch = async function() {
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput.value;
    state[currentTab].searchTerm = searchTerm;
    state[currentTab].currentPage = 0;
    state[currentTab].selectedKey = null;
    state[currentTab].selectedValue = null;
    state[currentTab].selectedForDeletion.clear();
    state[currentTab].lastCheckedIndex = -1;
    
    try {
        let result;
        const offset = state[currentTab].currentPage * pageSize;
        
        switch(currentTab) {
            case 'values':
                result = await App.SearchValues(searchTerm, offset, pageSize);
                break;
            case 'cache':
                result = await App.SearchCache(searchTerm, offset, pageSize);
                break;
            case 'blobs':
                result = await App.SearchBlobs(searchTerm, offset, pageSize);
                break;
        }
        
        state[currentTab].keys = result.keys || [];
        document.getElementById('key-list').innerHTML = renderKeyList();
        document.getElementById('key-details').innerHTML = renderDetails();
    } catch (error) {
        console.error('Search error:', error);
        document.getElementById('key-list').innerHTML = '<div class="error">Error performing search</div>';
    }
};

window.loadMore = async function() {
    state[currentTab].currentPage++;
    const searchTerm = state[currentTab].searchTerm;
    
    try {
        let result;
        const offset = state[currentTab].currentPage * pageSize;
        
        switch(currentTab) {
            case 'values':
                result = await App.SearchValues(searchTerm, offset, pageSize);
                break;
            case 'cache':
                result = await App.SearchCache(searchTerm, offset, pageSize);
                break;
            case 'blobs':
                result = await App.SearchBlobs(searchTerm, offset, pageSize);
                break;
        }
        
        if (result.keys && result.keys.length > 0) {
            state[currentTab].keys = [...state[currentTab].keys, ...result.keys];
            document.getElementById('key-list').innerHTML = renderKeyList();
        }
    } catch (error) {
        console.error('Load more error:', error);
    }
};

window.selectKey = async function(key) {
    editMode = false;
    state[currentTab].selectedKey = key;
    document.getElementById('key-list').innerHTML = renderKeyList();
    
    const detailsEl = document.getElementById('key-details');
    detailsEl.innerHTML = '<div class="loading">Loading...</div>';
    
    try {
        let value;
        
        switch(currentTab) {
            case 'values':
                value = await App.GetValue(key);
                break;
            case 'cache':
                value = await App.GetCache(key);
                break;
            case 'blobs':
                const blobData = await App.DownloadBlob(key);
                value = JSON.parse(blobData);
                break;
        }
        
        if (value === '' || value === null || value === undefined) {
            state[currentTab].selectedValue = value || '';
        } else {
            state[currentTab].selectedValue = value;
        }
        
        detailsEl.innerHTML = renderDetails();
    } catch (error) {
        console.error('Error loading key details:', error);
        state[currentTab].selectedKey = null;
        state[currentTab].selectedValue = null;
        detailsEl.innerHTML = `<div class="error">Error loading details: ${error.message || error}</div>`;
        document.getElementById('key-list').innerHTML = renderKeyList();
    }
};

window.handleCheckboxMouseDown = function(key, index, event) {
    console.log('handleCheckboxMouseDown', { key, index, shiftKey: event.shiftKey });
    
    const tabState = state[currentTab];
    const selectedSet = tabState.selectedForDeletion;
    
    if (event.shiftKey && tabState.lastCheckedIndex !== -1 && tabState.lastCheckedIndex !== index) {
        // Shift-click: select range
        event.preventDefault(); // Prevent checkbox from toggling
        
        console.log('Shift-click detected', { 
            lastIndex: tabState.lastCheckedIndex, 
            currentIndex: index 
        });
        
        const start = Math.min(tabState.lastCheckedIndex, index);
        const end = Math.max(tabState.lastCheckedIndex, index);
        
        console.log('Selecting range', { start, end });
        
        // Clear existing selection and select range
        selectedSet.clear();
        for (let i = start; i <= end; i++) {
            if (i < tabState.keys.length) {
                selectedSet.add(tabState.keys[i]);
            }
        }
        
        renderApp();
    } else {
        // Normal click
        event.preventDefault(); // Prevent default checkbox behavior
        
        // Toggle selection
        if (selectedSet.has(key)) {
            selectedSet.delete(key);
        } else {
            selectedSet.add(key);
        }
        
        // Update last checked index
        tabState.lastCheckedIndex = index;
        
        renderApp();
    }
};

window.deleteSelected = async function() {
    const selectedKeys = Array.from(state[currentTab].selectedForDeletion);
    
    if (selectedKeys.length === 0) {
        return;
    }
    
    const confirmed = await showConfirm(
        'Confirm Deletion',
        `Are you sure you want to delete ${selectedKeys.length} key${selectedKeys.length > 1 ? 's' : ''}?`
    );
    
    if (!confirmed) {
        return;
    }
    
    const errors = [];
    for (const key of selectedKeys) {
        try {
            switch(currentTab) {
                case 'values':
                    await App.DeleteValue(key);
                    break;
                case 'cache':
                    await App.DeleteCache(key);
                    break;
                case 'blobs':
                    await App.DeleteBlob(key);
                    break;
            }
            
            state[currentTab].keys = state[currentTab].keys.filter(k => k !== key);
            if (state[currentTab].selectedKey === key) {
                state[currentTab].selectedKey = null;
                state[currentTab].selectedValue = null;
            }
        } catch (error) {
            errors.push({key, error});
        }
    }
    
    state[currentTab].selectedForDeletion.clear();
    state[currentTab].lastCheckedIndex = -1;
    
    if (errors.length > 0) {
        alert(`Failed to delete ${errors.length} key(s). Check console for details.`);
        console.error('Delete errors:', errors);
    }
    
    renderApp();
};

window.enterEditMode = function() {
    editMode = true;
    document.getElementById('key-details').innerHTML = renderDetails();
    setTimeout(() => {
        const textarea = document.getElementById('edit-value');
        if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
    }, 0);
};

window.cancelEdit = function() {
    editMode = false;
    document.getElementById('key-details').innerHTML = renderDetails();
};

window.saveValue = async function() {
    const key = state[currentTab].selectedKey;
    const newValue = document.getElementById('edit-value').value;
    
    try {
        switch(currentTab) {
            case 'values':
                await App.SetValue(key, newValue);
                break;
            case 'cache':
                await App.SetCache(key, newValue);
                break;
        }
        
        state[currentTab].selectedValue = newValue;
        editMode = false;
        document.getElementById('key-details').innerHTML = renderDetails();
    } catch (error) {
        console.error('Save error:', error);
        alert(`Error saving value: ${error.message || error}`);
    }
};

window.showInsertDialog = function() {
    document.getElementById('insert-modal').style.display = 'flex';
    setTimeout(() => {
        document.getElementById('insert-key').focus();
    }, 0);
};

window.closeInsertDialog = function() {
    document.getElementById('insert-modal').style.display = 'none';
    document.getElementById('insert-key').value = '';
    const valueElement = document.getElementById('insert-value');
    if (valueElement) {
        valueElement.value = '';
    }
};

window.insertNewValue = async function() {
    const key = document.getElementById('insert-key').value.trim();
    
    if (!key) {
        alert('Key cannot be empty');
        return;
    }
    
    try {
        switch(currentTab) {
            case 'values':
                const value = document.getElementById('insert-value').value;
                await App.SetValue(key, value);
                break;
            case 'cache':
                const cacheValue = document.getElementById('insert-value').value;
                await App.SetCache(key, cacheValue);
                break;
            case 'blobs':
                // For blobs, we call the upload function which opens file dialog
                await App.UploadBlob(key);
                break;
        }
        
        closeInsertDialog();
        
        // Always refresh the current search to show updated results
        await performSearch();
        
        // Try to select the newly inserted key if it's in the results
        if (state[currentTab].keys.includes(key)) {
            await selectKey(key);
        } else {
            // Key not in current search results, show a message
            console.log(`Inserted key "${key}" successfully, but it's not in the current search results.`);
        }
    } catch (error) {
        console.error('Insert error:', error);
        alert(`Error inserting: ${error.message || error}`);
    }
};

window.deleteKey = async function(key) {
    const confirmed = await showConfirm(
        'Confirm Deletion',
        `Are you sure you want to delete "${key}"?`
    );
    
    if (!confirmed) {
        return;
    }
    
    try {
        const detailsEl = document.getElementById('key-details');
        detailsEl.innerHTML = '<div class="loading">Deleting...</div>';
        
        switch(currentTab) {
            case 'values':
                await App.DeleteValue(key);
                break;
            case 'cache':
                await App.DeleteCache(key);
                break;
            case 'blobs':
                await App.DeleteBlob(key);
                break;
        }
        
        state[currentTab].keys = state[currentTab].keys.filter(k => k !== key);
        
        if (state[currentTab].selectedKey === key) {
            state[currentTab].selectedKey = null;
            state[currentTab].selectedValue = null;
        }
        
        state[currentTab].selectedForDeletion.delete(key);
        
        document.getElementById('key-list').innerHTML = renderKeyList();
        document.getElementById('key-details').innerHTML = renderDetails();
        
        if (state[currentTab].keys.length === 0) {
            document.getElementById('key-list').innerHTML = '<div class="no-results">No keys found. Try searching with a prefix.</div>';
        }
        
    } catch (error) {
        console.error('Delete error:', error);
        alert(`Error deleting key: ${error.message || error}`);
    }
};

// Handle escape key to close modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('insert-modal');
        if (modal && modal.style.display !== 'none') {
            closeInsertDialog();
        } else if (editMode) {
            cancelEdit();
        }
    }
});

// Add event delegation for checkbox clicks
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('key-checkbox')) {
        const index = parseInt(e.target.dataset.index);
        const key = e.target.dataset.key;
        
        console.log('Delegated click', { key, index, shiftKey: e.shiftKey });
        
        // Call our handler
        if (key !== undefined && !isNaN(index)) {
            e.preventDefault();
            handleCheckboxClick(key, index, e);
        }
    }
}, true); // Use capture phase

// Separate handler for processing the click
function handleCheckboxClick(key, index, event) {
    const tabState = state[currentTab];
    const selectedSet = tabState.selectedForDeletion;
    
    if (event.shiftKey && tabState.lastCheckedIndex !== -1 && tabState.lastCheckedIndex !== index) {
        // Shift-click: select range
        console.log('Processing shift-click', { 
            lastIndex: tabState.lastCheckedIndex, 
            currentIndex: index 
        });
        
        const start = Math.min(tabState.lastCheckedIndex, index);
        const end = Math.max(tabState.lastCheckedIndex, index);
        
        // Add range to selection (don't clear existing)
        for (let i = start; i <= end; i++) {
            if (i < tabState.keys.length) {
                selectedSet.add(tabState.keys[i]);
            }
        }
    } else {
        // Normal click - toggle single item
        if (selectedSet.has(key)) {
            selectedSet.delete(key);
        } else {
            selectedSet.add(key);
        }
        
        // Update last checked index
        tabState.lastCheckedIndex = index;
    }
    
    renderApp();
}

function renderEventsTab() {
    return `
        <div class="events-container">
            <div class="events-sidebar">
                <div class="events-sidebar-header">
                    <h3>Subscriptions</h3>
                    <button class="purge-btn" onclick="purgeAllSubscribers()" title="Purge all subscribers">
                        <span class="icon">🧹</span> Purge All
                    </button>
                </div>
                <div class="subscribe-form">
                    <input 
                        type="text" 
                        id="subscribe-topic" 
                        class="topic-input" 
                        placeholder="Enter topic to subscribe..." 
                        onkeyup="handleSubscribeKeyup(event)"
                    />
                    <button class="subscribe-btn" onclick="subscribeToTopic()">Subscribe</button>
                </div>
                <div class="subscriptions-list">
                    ${Array.from(state.events.subscriptions).map(topic => `
                        <div class="subscription-item">
                            <span class="topic-name">${escapeHtml(topic)}</span>
                            <button class="unsubscribe-btn" onclick="unsubscribeFromTopic('${escapeHtml(topic)}')">×</button>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="events-main">
                <div class="events-main-header">
                    <h3>Events</h3>
                    <div class="publish-form">
                        <input 
                            type="text" 
                            id="publish-topic" 
                            class="topic-input" 
                            placeholder="Topic..." 
                        />
                        <input 
                            type="text" 
                            id="publish-data" 
                            class="data-input" 
                            placeholder="Data..." 
                            onkeyup="handlePublishKeyup(event)"
                        />
                        <button class="publish-btn" onclick="publishEvent()">Publish</button>
                    </div>
                </div>
                <div class="events-messages" id="events-messages">
                    ${state.events.messages.map(msg => `
                        <div class="event-message">
                            <div class="event-header">
                                <span class="event-topic">${escapeHtml(msg.topic)}</span>
                                <span class="event-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div class="event-data">${escapeHtml(msg.data)}</div>
                        </div>
                    `).join('')}
                    ${state.events.messages.length === 0 ? '<div class="no-messages">No events received yet. Subscribe to topics to see events.</div>' : ''}
                </div>
            </div>
        </div>
    `;
}

window.handleSubscribeKeyup = function(event) {
    if (event.key === 'Enter') {
        subscribeToTopic();
    }
};

window.handlePublishKeyup = function(event) {
    if (event.key === 'Enter') {
        publishEvent();
    }
};

window.subscribeToTopic = async function() {
    const input = document.getElementById('subscribe-topic');
    const topic = input.value.trim();
    
    if (!topic) {
        return;
    }
    
    if (state.events.subscriptions.has(topic)) {
        alert('Already subscribed to this topic');
        return;
    }
    
    try {
        await App.SubscribeToTopic(topic);
        state.events.subscriptions.add(topic);
        input.value = '';
        renderApp();
    } catch (error) {
        console.error('Subscribe error:', error);
        alert(`Error subscribing to topic: ${error.message || error}`);
    }
};

window.unsubscribeFromTopic = async function(topic) {
    try {
        await App.UnsubscribeFromTopic(topic);
        state.events.subscriptions.delete(topic);
        renderApp();
    } catch (error) {
        console.error('Unsubscribe error:', error);
        alert(`Error unsubscribing from topic: ${error.message || error}`);
    }
};

window.publishEvent = async function() {
    const topicInput = document.getElementById('publish-topic');
    const dataInput = document.getElementById('publish-data');
    
    const topic = topicInput.value.trim();
    const data = dataInput.value.trim();
    
    if (!topic || !data) {
        alert('Both topic and data are required');
        return;
    }
    
    try {
        console.log('Publishing event:', { topic, data });
        await App.PublishEvent(topic, data);
        dataInput.value = '';
        
        // Add visual feedback
        const publishBtn = document.querySelector('.publish-btn');
        const originalText = publishBtn.textContent;
        publishBtn.textContent = '✓ Published';
        publishBtn.style.background = '#10b981';
        
        setTimeout(() => {
            publishBtn.textContent = originalText;
            publishBtn.style.background = '';
        }, 1000);
    } catch (error) {
        console.error('Publish error:', error);
        alert(`Error publishing event: ${error.message || error}`);
    }
};

window.purgeAllSubscribers = async function() {
    const confirmed = await showConfirm(
        'Purge All Subscribers',
        'Are you sure you want to purge all subscribers across all nodes? This will disconnect all event subscribers system-wide.'
    );
    
    if (!confirmed) {
        return;
    }
    
    try {
        const count = await App.PurgeAllSubscribers();
        alert(`Successfully purged ${count} subscribers`);
        
        // Clear local subscriptions too
        for (const topic of state.events.subscriptions) {
            await App.UnsubscribeFromTopic(topic);
        }
        state.events.subscriptions.clear();
        renderApp();
    } catch (error) {
        console.error('Purge error:', error);
        alert(`Error purging subscribers: ${error.message || error}`);
    }
};

// Listen for events from backend
EventsOn('event-received', (msg) => {
    console.log('Event received:', msg);
    state.events.messages.unshift(msg);
    
    // Keep only the last maxMessages
    if (state.events.messages.length > state.events.maxMessages) {
        state.events.messages = state.events.messages.slice(0, state.events.maxMessages);
    }
    
    // Update UI if on events tab
    if (currentTab === 'events') {
        const messagesEl = document.getElementById('events-messages');
        if (messagesEl) {
            messagesEl.innerHTML = state.events.messages.map(msg => `
                <div class="event-message">
                    <div class="event-header">
                        <span class="event-topic">${escapeHtml(msg.topic)}</span>
                        <span class="event-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div class="event-data">${escapeHtml(msg.data)}</div>
                </div>
            `).join('');
        }
    }
});

EventsOn('subscription-error', (error) => {
    console.error('Subscription error:', error);
    alert(`Subscription error for topic "${error.topic}": ${error.error}`);
});

renderApp();