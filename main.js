const { Plugin, PluginSettingTab, Setting, setIcon } = require('obsidian');

const PLAYBACK_MODES = ['loop', 'single', 'shuffle'];
const DEFAULT_SETTINGS = {
    musicFolderPaths: [],
    favorites: [],
    playbackMode: PLAYBACK_MODES[0]
};

class VaultRadioPlugin extends Plugin {
    async onload() {
        try {
            await this.loadSettings();
            this.audioPlayer = new Audio();
            this.fullPlaylist = []; this.viewPlaylist = [];
            this.nowPlayingTrack = null; this.isPlaying = false;
            this.isDragging = false; 
            
            this.setupUI();
            this.registerEventListeners();
            this.addSettingTab(new VaultRadioSettingTab(this.app, this));
            await this.loadFullPlaylist();
        } catch (e) { console.error("Vault Radio plugin load error:", e); }
    }

    // --- 核心修复：重构事件监听和播放结束逻辑 ---
    registerEventListeners() {
        this.registerDomEvent(this.playPauseButton, 'click', () => this.togglePlayPause());
        this.registerDomEvent(this.prevButton, 'click', () => this.playPrevious());
        this.registerDomEvent(this.nextButton, 'click', () => this.playNext()); // “下一首”按钮现在只调用 playNext
        this.registerDomEvent(this.playlistTrackButton, 'click', () => this.toggleHub());
        
        // 歌曲自然播放结束时，调用专门的处理器
        this.registerDomEvent(this.audioPlayer, 'ended', () => this.handleTrackEnd());
        
        this.registerDomEvent(this.audioPlayer, 'timeupdate', () => this.updateProgress());
        this.registerDomEvent(this.hubProgressContainer, 'mousedown', this.handleDragStart);
        this.registerDomEvent(this.modeButton, 'click', () => this.togglePlaybackMode());
        this.registerDomEvent(this.favButton, 'click', () => this.toggleFavorite());
        this.registerDomEvent(this.categorySelect, 'change', () => this.handleCategoryChange());
        this.registerEvent(this.app.vault.on('create', (file) => this.handleFileChange(file.path)));
        this.registerEvent(this.app.vault.on('delete', (file) => this.handleFileChange(file.path)));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.handleFileChange(oldPath)));
    }

    handleTrackEnd() {
        // 只有在歌曲自然播放结束时，才检查是否为单曲循环
        if (this.settings.playbackMode === 'single' && this.nowPlayingTrack) {
            this.audioPlayer.currentTime = 0;
            this.play();
            return;
        }
        // 其他模式下，正常播放下一首
        this.playNext();
    }
    
    playNext() {
        if (this.viewPlaylist.length === 0) return;
        const currentIndexInView = this.nowPlayingTrack ? this.viewPlaylist.findIndex(t => t.id === this.nowPlayingTrack.id) : -1;
        const nextIndex = (currentIndexInView + 1) % this.viewPlaylist.length;
        this.loadTrack(this.viewPlaylist[nextIndex], true);
    }
    
    playPrevious() {
        if (this.viewPlaylist.length === 0) return;
        const currentIndexInView = this.nowPlayingTrack ? this.viewPlaylist.findIndex(t => t.id === this.nowPlayingTrack.id) : -1;
        const prevIndex = (currentIndexInView === -1) ? this.viewPlaylist.length - 1 : (currentIndexInView - 1 + this.viewPlaylist.length) % this.viewPlaylist.length;
        this.loadTrack(this.viewPlaylist[prevIndex], true);
    }

    // --- 以下为稳定代码 ---
    setupUI() { this.statusBarItem = this.addStatusBarItem(); this.statusBarItem.addClass('minimal-player-statusbar-new'); this.prevButton = this.statusBarItem.createEl('button', { cls: 'minimal-player-button' }); setIcon(this.prevButton, 'skip-back'); this.playPauseButton = this.statusBarItem.createEl('button', { cls: 'minimal-player-button' }); setIcon(this.playPauseButton, 'play'); this.nextButton = this.statusBarItem.createEl('button', { cls: 'minimal-player-button' }); setIcon(this.nextButton, 'skip-forward'); this.playlistTrackButton = this.statusBarItem.createEl('button', { cls: 'playlist-track-button' }); this.trackNameEl = this.playlistTrackButton.createEl('span', { text: '播放列表' }); this.statusBarProgress = this.playlistTrackButton.createEl('div', { cls: 'status-bar-progress' }); this.hubContainer = document.body.createEl('div', { cls: 'minimal-player-hub-container' }); this.hubContainer.hide(); const hubFunctionBar = this.hubContainer.createEl('div', { cls: 'hub-function-bar' }); this.favButton = hubFunctionBar.createEl('button', { cls: 'hub-function-button' }); this.categorySelect = hubFunctionBar.createEl('select', { cls: 'hub-function-select' }); this.modeButton = hubFunctionBar.createEl('button', { cls: 'hub-function-button' }); this.updateFavButton(); this.updateModeIcon(); const hubControls = this.hubContainer.createEl('div', { cls: 'hub-controls' }); this.hubProgressContainer = hubControls.createEl('div', { cls: 'hub-progress-container' }); this.hubProgressFill = this.hubProgressContainer.createEl('div', { cls: 'hub-progress-fill' }); this.hubProgressThumb = this.hubProgressContainer.createEl('div', { cls: 'hub-progress-thumb' }); this.hubTimeDisplay = hubControls.createEl('div', { cls: 'hub-time-display' }); this.hubPlaylist = this.hubContainer.createEl('ul', { cls: 'hub-playlist' }); }
    async loadFullPlaylist() { this.fullPlaylist = []; const validFolders = this.settings.musicFolderPaths.filter(p => p && p.trim() !== ''); if (validFolders.length > 0) { const allFiles = this.app.vault.getFiles(); let collectedFiles = new Map(); validFolders.forEach(folderPath => { const normalizedPath = folderPath.replace(/\\/g, '/'); allFiles.forEach(file => { if (file.path.startsWith(normalizedPath) && ['flac', 'mp3', 'wav', 'm4a', 'ogg'].includes(file.extension.toLowerCase())) { collectedFiles.set(file.path, file); } }); }); this.fullPlaylist = Array.from(collectedFiles.values()).map((f, index) => ({ id: index, name: f.basename, path: f.path, resourcePath: this.app.vault.getResourcePath(f) })); } this.updateCategorySelector(); this.updateView(); }
    updateCategorySelector() { const currentVal = this.categorySelect.value; this.categorySelect.empty(); this.categorySelect.add(new Option("所有歌曲", "all")); this.categorySelect.add(new Option("喜爱列表", "favorite")); const validFolders = this.settings.musicFolderPaths.filter(p => p && p.trim() !== ''); if (validFolders.length > 1) { validFolders.forEach(path => { this.categorySelect.add(new Option(path.split('/').pop() || path, path)); }); } if (Array.from(this.categorySelect.options).some(option => option.value === currentVal)) { this.categorySelect.value = currentVal; } else { this.categorySelect.value = 'all'; this.currentCategory = 'all'; } }
    updateView() { let sourcePlaylist = []; const category = this.categorySelect.value || 'all'; if (category === 'all') { sourcePlaylist = this.fullPlaylist; } else if (category === 'favorite') { sourcePlaylist = this.fullPlaylist.filter(t => this.settings.favorites.includes(t.path)); } else { sourcePlaylist = this.fullPlaylist.filter(t => t.path.startsWith(category)); } if (this.settings.playbackMode === 'shuffle') { this.viewPlaylist = [...sourcePlaylist].sort(() => Math.random() - 0.5); } else { this.viewPlaylist = sourcePlaylist; } if (!this.nowPlayingTrack || !this.fullPlaylist.some(t => t.path === this.nowPlayingTrack.path)) { this.loadTrack(this.viewPlaylist[0], false); } else { this.renderPlaylist(); } }
    loadTrack(track, autoPlay) { if (!track) { this.nowPlayingTrack = null; this.audioPlayer.src = ""; this.trackNameEl.setText("播放列表"); } else { this.nowPlayingTrack = track; this.trackNameEl.setText(track.name); if (this.audioPlayer.src !== track.resourcePath) { this.audioPlayer.src = track.resourcePath; } } this.checkAndApplyScrolling(); this.updateFavButton(); this.renderPlaylist(); this.updateProgress(); if (autoPlay) this.play(); else this.pause(); }
    renderPlaylist() { this.hubPlaylist.empty(); if (this.viewPlaylist.length === 0) { this.hubPlaylist.createEl('li', { text: "此列表为空", cls: 'playlist-empty' }); return; } this.viewPlaylist.forEach((track) => { const li = this.hubPlaylist.createEl('li', { cls: 'playlist-item' }); li.createEl('span', { text: track.name, cls: 'playlist-item-name' }); if (this.nowPlayingTrack && track.id === this.nowPlayingTrack.id) { li.addClass('is-playing'); } li.draggable = true; li.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData("text/plain", `![[${track.path}]]`); }); li.addEventListener('click', () => { this.loadTrack(track, true); }); }); }
    updateFavButton() { setIcon(this.favButton, 'heart'); if (this.nowPlayingTrack && this.settings.favorites.includes(this.nowPlayingTrack.path)) { this.favButton.addClass('is-favorite'); } else { this.favButton.removeClass('is-favorite'); } }
    updateModeIcon() { const iconMap = { loop: 'repeat', single: 'repeat-1', shuffle: 'shuffle' }; setIcon(this.modeButton, iconMap[this.settings.playbackMode]); }
    play() { if (!this.nowPlayingTrack) return; this.audioPlayer.play(); this.isPlaying = true; setIcon(this.playPauseButton, 'pause'); }
    pause() { this.audioPlayer.pause(); this.isPlaying = false; setIcon(this.playPauseButton, 'play'); }
    togglePlayPause() { this.isPlaying ? this.pause() : this.play(); }
    togglePlaybackMode() { const currentIndex = PLAYBACK_MODES.indexOf(this.settings.playbackMode); this.settings.playbackMode = PLAYBACK_MODES[(currentIndex + 1) % PLAYBACK_MODES.length]; this.saveSettings(); this.updateModeIcon(); this.updateView(); }
    toggleFavorite() { if (!this.nowPlayingTrack) return; const favIndex = this.settings.favorites.indexOf(this.nowPlayingTrack.path); if (favIndex > -1) { this.settings.favorites.splice(favIndex, 1); } else { this.settings.favorites.push(this.nowPlayingTrack.path); } this.saveSettings(); this.updateFavButton(); if (this.categorySelect.value === 'favorite') this.updateView(); }
    handleCategoryChange() { this.currentCategory = this.categorySelect.value; this.updateView(); }
    handleFileChange(path) { if (this.settings.musicFolderPaths.some(p => p && path.startsWith(p))) { setTimeout(() => this.loadFullPlaylist(), 500); } }
    checkAndApplyScrolling() { requestAnimationFrame(() => { const bw = this.playlistTrackButton.clientWidth; const tw = this.trackNameEl.scrollWidth; if (tw > bw) { this.trackNameEl.addClass('is-scrolling'); this.trackNameEl.style.setProperty('--button-width', `${bw}px`); } else { this.trackNameEl.removeClass('is-scrolling'); } }); }
    handleDragStart = (e) => { this.isDragging = true; this.hubContainer.addClass('is-dragging'); this.seek(e); document.addEventListener('mousemove', this.handleDragMove); document.addEventListener('mouseup', this.handleDragEnd); }
    handleDragMove = (e) => { if (this.isDragging) { this.updateVisualProgress(e); } }
    handleDragEnd = (e) => { if (this.isDragging) { this.isDragging = false; this.hubContainer.removeClass('is-dragging'); this.seek(e); document.removeEventListener('mousemove', this.handleDragMove); document.removeEventListener('mouseup', this.handleDragEnd); } }
    updateProgress() { if (this.isDragging) return; const { currentTime, duration } = this.audioPlayer; if (isNaN(duration) || !isFinite(duration)) { this.hubTimeDisplay.setText("--:-- / --:--"); this.statusBarProgress.style.width = '0%'; this.hubProgressFill.style.width = '0%'; this.hubProgressThumb.style.left = '-5px'; return; } const p = (currentTime / duration) * 100; this.statusBarProgress.style.width = `${p}%`; this.hubProgressFill.style.width = `${p}%`; this.hubProgressThumb.style.left = `calc(${p}% - 5px)`; const f = (s) => new Date(s * 1000).toISOString().slice(14, 19); this.hubTimeDisplay.setText(`${f(currentTime)} / ${f(duration)}`); }
    updateVisualProgress(e) { const { duration } = this.audioPlayer; if (isNaN(duration)) return; const rect = this.hubProgressContainer.getBoundingClientRect(); let progress = (e.clientX - rect.left) / rect.width; progress = Math.max(0, Math.min(1, progress)); const p = progress * 100; this.hubProgressFill.style.width = `${p}%`; this.hubProgressThumb.style.left = `calc(${p}% - 5px)`; }
    seek(e) { const { duration } = this.audioPlayer; if (isNaN(duration)) return; const rect = this.hubProgressContainer.getBoundingClientRect(); let progress = (e.clientX - rect.left) / rect.width; progress = Math.max(0, Math.min(1, progress)); this.audioPlayer.currentTime = progress * duration; }
    toggleHub() { if (this.hubContainer.style.display === 'none') { const buttonRect = this.playlistTrackButton.getBoundingClientRect(); const hubWidth = 300; const screenWidth = window.innerWidth; let hubLeft = buttonRect.left; if (hubLeft + hubWidth > screenWidth) { hubLeft = buttonRect.right - hubWidth; } this.hubContainer.style.bottom = `${window.innerHeight - buttonRect.top}px`; this.hubContainer.style.left = `${Math.max(0, hubLeft)}px`; this.hubContainer.show(); this.registerDomEvent(document, 'click', this.handleDocumentClick, { capture: true }); } else { this.hubContainer.hide(); this.app.workspace.containerEl.ownerDocument.removeEventListener('click', this.handleDocumentClick, { capture: true }); } }
    handleDocumentClick = (evt) => { if (!this.hubContainer.contains(evt.target) && !this.playlistTrackButton.contains(evt.target)) { this.toggleHub(); } }
    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }
    onunload() { if (this.audioPlayer) this.audioPlayer.pause(); if (this.hubContainer) this.hubContainer.remove(); }
}

class VaultRadioSettingTab extends PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this; 
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Vault Radio 设置' });
        containerEl.createEl('p', { text: '在这里管理您的音乐文件夹。路径必须在您的 Obsidian 仓库内部。'});
        containerEl.createEl('p', { text: 'Manage your music folders here. Paths must be inside your Obsidian Vault.', cls: 'setting-item-description' });
        this.plugin.settings.musicFolderPaths.forEach((path, index) => {
            new Setting(containerEl).addText(text => text.setValue(path).setPlaceholder('例如: Music/Collection').onChange(async (value) => { this.plugin.settings.musicFolderPaths[index] = value.trim().replace(/\\/g, '/'); await this.plugin.saveSettings(); this.plugin.loadFullPlaylist(); })).addExtraButton(button => button.setIcon('trash').setTooltip('删除').onClick(async () => { this.plugin.settings.musicFolderPaths.splice(index, 1); await this.plugin.saveSettings(); this.plugin.loadFullPlaylist(); this.display(); }));
        });
        new Setting(containerEl).addButton(button => button.setButtonText('添加新文件夹').onClick(async () => { this.plugin.settings.musicFolderPaths.push(""); await this.plugin.saveSettings(); this.display(); }));
    }
}

module.exports = VaultRadioPlugin;
