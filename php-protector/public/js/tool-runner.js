/**
 * tool-runner.js
 * Unified frontend engine for processing single files or recursive folders.
 */
document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const folderInput = document.getElementById('folder-input');
    const resetBtn = document.getElementById('reset-btn');
    const downloadBtn = document.getElementById('download-btn');
    
    let processedBlob = null;
    let fileName = 'processed.zip';
    let currentMode = 'bulk'; // 'single' or 'bulk'

    // Mode handling
    const modeTabs = document.querySelectorAll('.mode-tab');
    if (modeTabs.length > 0) {
        modeTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                modeTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentMode = tab.dataset.mode;
                
                // Update folder input behavior
                if (currentMode === 'bulk') {
                    folderInput.webkitdirectory = true;
                    folderInput.multiple = true;
                    document.querySelector('.drop-title').innerText = 'Drop your folder here';
                    document.querySelector('.drop-sub').innerText = 'Processed recursive folder as ZIP';
                } else {
                    folderInput.webkitdirectory = false;
                    folderInput.multiple = false;
                    document.querySelector('.drop-title').innerText = 'Drop your file here';
                    document.querySelector('.drop-sub').innerText = 'Processed single file download';
                }
            });
        });
    }

    // Input handlers
    folderInput.addEventListener('change', (e) => handleSelection(e.target.files));
    
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('active');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('active'));

    dropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropzone.classList.remove('active');
        
        let files = [];
        if (currentMode === 'bulk') {
            files = await readDroppedFolder(e.dataTransfer.items);
        } else {
            files = Array.from(e.dataTransfer.files);
        }
        
        if (files.length > 0) handleSelection(files);
    });

    async function handleSelection(files) {
        if (!files || files.length === 0) return;
        
        document.getElementById('dropzone').classList.add('hidden');
        if (document.getElementById('options-panel')) document.getElementById('options-panel').classList.add('hidden');
        document.getElementById('stats').classList.remove('hidden');
        document.getElementById('progress-wrap').classList.remove('hidden');
        document.getElementById('stat-total').innerText = files.length;
        
        const statLabel = document.querySelector('.stat-label');
        if (statLabel) statLabel.innerText = files.length === 1 ? 'File queued' : 'Files queued';

        const formData = new FormData();
        
        // Collect files and relative paths
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
            const path = files[i].webkitRelativePath || files[i].name;
            formData.append('paths', path);
        }

        // Collect all input values by ID
        const inputs = document.querySelectorAll('input, select');
        inputs.forEach(input => {
            if (input.type === 'checkbox') {
                formData.append(input.id, input.checked);
            } else if (input.id) {
                formData.append(input.id, input.value);
            }
        });

        // Use the global toolEndpoint defined in EJS
        const endpoint = window.toolEndpoint || '/upload';

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Processing failed on server');

            // Detect filename from content-disposition
            const contentDisp = response.headers.get('content-disposition');
            if (contentDisp && contentDisp.includes('filename=')) {
                fileName = contentDisp.split('filename=')[1].replace(/"/g, '');
            }

            processedBlob = await response.blob();
            
            // Show Success
            document.getElementById('progress-wrap').classList.add('hidden');
            const downloadWrap = document.getElementById('download-wrap');
            downloadWrap.classList.remove('hidden');
            
            // 🔥 Dynamic Text Updates
            const doneMsg = downloadWrap.querySelector('.done-message');
            const dlBtn = document.getElementById('download-btn');
            
            if (currentMode === 'single') {
                doneMsg.innerText = 'Processing complete!';
                dlBtn.innerText = 'Download Processed File';
            } else {
                doneMsg.innerText = 'Bulk processing complete!';
                dlBtn.innerText = 'Download Archive (.zip)';
            }

            document.getElementById('progress-bar').style.width = '100%';
        } catch (err) {
            alert('Error: ' + err.message);
            location.reload();
        }
    }

    downloadBtn.addEventListener('click', () => {
        if (!processedBlob) return;
        const url = URL.createObjectURL(processedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    resetBtn.addEventListener('click', () => location.reload());
});
