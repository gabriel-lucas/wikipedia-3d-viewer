/*
 * This file is part of the MediaWiki extension 3D.
 *
 * The 3D extension is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * The 3D extension is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with The 3D extension. If not, see <http://www.gnu.org/licenses/>.
 */

window.THREE = require('./lib/three/three.js');

let singleton = false;

function ThreeD(viewer) {
	THREE.Cache.enabled = true;

	this.viewer = viewer;
	this.progressBar = viewer.ui.panel.progressBar;
	this.$container = viewer.ui.canvas.$imageDiv;

	// Animation state
	this.mixer = null;
	this.animations = [];
	this.currentAction = null;
	this.isPlaying = false;
	this.currentTrackIndex = 0;
	this.repeatMode = 'all'; // 'single', 'all', 'none'
	this.playbackSpeed = 1;
	this.SPEEDS = [0.2, 0.5, 1, 2];
	this.speedIndex = 2; // default x1
	this.lastTime = 0;

	// Camera state for reset
	this.initialCameraPosition = null;
	this.initialCameraTarget = null;

	// Camera transition
	this.camTransition = null;

	// Toolbar reference
	this.toolbar = null;
	this.isGLTF = false;
}

const TD = ThreeD.prototype;

TD.init = function () {
	const dimensions = this.getDimensions();

	this.renderer = new THREE.WebGLRenderer({ antialias: true });
	this.renderer.setClearColor(0x111111);
	this.renderer.setPixelRatio(window.devicePixelRatio);
	this.renderer.setSize(dimensions.width, dimensions.height);
	this.renderer.shadowMap.enabled = true;
	this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
	this.renderer.toneMappingExposure = 1.0;
	this.$container.html(this.renderer.domElement);

	this.manager = new THREE.LoadingManager();

	this.camera = new THREE.PerspectiveCamera(45, dimensions.ratio, 0.001, 500000);
	this.camera.up.set(0, 1, 0);

	// Subtle headlight
	const headlight = new THREE.DirectionalLight(0xffffff, 1.0);
	headlight.position.set(0, 0, 1);
	this.camera.add(headlight);

	// OrbitControls
	this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
	this.controls.enableDamping = true;
	this.controls.dampingFactor = 0.08;
	this.controls.rotateSpeed = 1.0;
	this.controls.zoomSpeed = 1.2;
	this.controls.panSpeed = 0.8;
	this.controls.screenSpacePanning = true;
	this.controls.minDistance = 0.001;
	this.controls.maxDistance = 500000;
	this.controls.mouseButtons = {
		LEFT: THREE.MOUSE.ROTATE,
		MIDDLE: THREE.MOUSE.PAN,
		RIGHT: THREE.MOUSE.PAN
	};
	this.controls.touches = {
		ONE: THREE.TOUCH.ROTATE,
		TWO: THREE.TOUCH.DOLLY_PAN
	};
	this.controls.addEventListener('start', this.controlsStart.bind(this));
	this.controls.addEventListener('end', this.controlsEnd.bind(this));

	this.scene = new THREE.Scene();
	this.scene.add(this.camera);
	this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

	// Raycaster for double-click focus
	this.raycaster = new THREE.Raycaster();
	this.mouse = new THREE.Vector2();

	this.setupEventHandlers();

	$(window).on('resize.3d', mw.util.debounce(this.onWindowResize.bind(this), 100));

	this.render();
};

/**
 * Set up environment lighting for PBR materials (GLTF models).
 */
TD.setupEnvironment = function () {
	const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
	const roomEnv = new THREE.RoomEnvironment();
	this.scene.environment = pmremGenerator.fromScene(roomEnv, 0.04).texture;
	pmremGenerator.dispose();
	roomEnv.dispose();
};

/**
 * Set up keyboard shortcuts and mouse/touch event handlers.
 */
TD.setupEventHandlers = function () {
	const domElement = this.renderer.domElement;

	$(document).on('keydown.3d', (e) => {
		if (e.key === ' ' || e.keyCode === 32) {
			e.preventDefault();
			this.resetCamera();
		}
	});

	let lastTapTime = 0;
	$(domElement).on('dblclick.3d', (e) => {
		e.preventDefault();
		this.handleDoubleClick(e);
	});

	$(domElement).on('touchend.3d', (e) => {
		const now = Date.now();
		if (now - lastTapTime < 300) {
			e.preventDefault();
			this.handleDoubleClick(e);
		}
		lastTapTime = now;
	});

	$(document).on('keydown.3d-shift', (e) => {
		if (e.key === 'Shift' && this.controls) {
			this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
		}
	});
	$(document).on('keyup.3d-shift', (e) => {
		if (e.key === 'Shift' && this.controls) {
			this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
		}
	});
};

// ----------------------------------------------------------------
// Camera helpers
// ----------------------------------------------------------------

TD.computeFraming = function (object) {
	const box = new THREE.Box3().setFromObject(object);
	if (box.isEmpty()) {
		return null;
	}
	const center = box.getCenter(new THREE.Vector3());
	const size = box.getSize(new THREE.Vector3());
	const maxDim = Math.max(size.x, size.y, size.z);
	const fov = this.camera.fov * (Math.PI / 180);
	const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.6;
	const pos = new THREE.Vector3(
		center.x + dist * 0.6,
		center.y + dist * 0.4,
		center.z + dist * 0.7
	);
	return { center, pos, dist, maxDim };
};

TD.startCameraTransition = function (toPos, toTarget, duration) {
	this.camTransition = {
		fromPos: this.camera.position.clone(),
		toPos: toPos.clone(),
		fromTarget: this.controls.target.clone(),
		toTarget: toTarget.clone(),
		start: performance.now(),
		duration: duration || 1200
	};
};

TD.updateCameraTransition = function () {
	if (!this.camTransition) {
		return;
	}
	const elapsed = performance.now() - this.camTransition.start;
	let t = Math.min(elapsed / this.camTransition.duration, 1);
	t = 1 - Math.pow(1 - t, 3); // ease-out cubic

	this.camera.position.lerpVectors(this.camTransition.fromPos, this.camTransition.toPos, t);
	this.controls.target.lerpVectors(this.camTransition.fromTarget, this.camTransition.toTarget, t);
	this.controls.update();

	if (t >= 1) {
		this.camTransition = null;
	}
};

TD.centerAndIntro = function (object) {
	const framing = this.computeFraming(object);
	if (!framing) {
		return;
	}

	// Start camera far away
	const farPos = framing.pos.clone().multiplyScalar(3);
	this.camera.position.copy(farPos);
	this.controls.target.copy(framing.center);
	this.controls.update();

	this.initialCameraPosition = framing.pos.clone();
	this.initialCameraTarget = framing.center.clone();

	this.startCameraTransition(framing.pos, framing.center, 1800);
};

TD.fitScene = function () {
	const framing = this.computeFraming(this.scene);
	if (!framing) {
		return;
	}
	this.startCameraTransition(framing.pos, framing.center, 800);
};

TD.resetCamera = function () {
	if (this.initialCameraPosition && this.initialCameraTarget) {
		this.startCameraTransition(this.initialCameraPosition, this.initialCameraTarget, 800);
	}
};

TD.handleDoubleClick = function (e) {
	const rect = this.renderer.domElement.getBoundingClientRect();
	let clientX, clientY;

	if (e.originalEvent && e.originalEvent.changedTouches) {
		const touch = e.originalEvent.changedTouches[0];
		clientX = touch.clientX;
		clientY = touch.clientY;
	} else {
		clientX = e.clientX || (e.originalEvent && e.originalEvent.clientX);
		clientY = e.clientY || (e.originalEvent && e.originalEvent.clientY);
	}

	this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
	this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

	this.raycaster.setFromCamera(this.mouse, this.camera);
	const intersects = this.raycaster.intersectObjects(this.scene.children, true);

	if (intersects.length > 0) {
		// Zoom to part: move 60% closer
		const hitPoint = intersects[0].point;
		const newTarget = hitPoint.clone();
		const dir = this.camera.position.clone().sub(hitPoint);
		const newPos = hitPoint.clone().add(dir.multiplyScalar(0.4));
		this.startCameraTransition(newPos, newTarget, 600);
	} else {
		this.fitScene();
	}
};

TD.geometryToObject = function (geometry) {
	const vertexColors = geometry.hasAttribute('color');
	const material = new THREE.MeshStandardMaterial({
		color: 0xc8bdb5,
		metalness: 0.15,
		roughness: 0.65,
		flatShading: true,
		side: THREE.DoubleSide,
		vertexColors
	});
	return new THREE.Mesh(geometry, material);
};

TD.render = function () {
	if (this.scene && this.camera) {
		this.renderer.render(this.scene, this.camera);
	}
};

TD.animate = function () {
	requestAnimationFrame(this.animate.bind(this));
	const now = performance.now();
	const delta = (now - this.lastTime) / 1000;
	this.lastTime = now;

	if (this.mixer && this.isPlaying) {
		this.mixer.update(delta);
		if (this.toolbar) {
			this.toolbar.updateAnimationProgress();
		}
	}

	this.updateCameraTransition();
	this.controls.update();
	this.render();
};

TD.onWindowResize = function () {
	const dimensions = this.getDimensions();
	this.camera.aspect = dimensions.width / dimensions.height;
	this.camera.updateProjectionMatrix();
	this.renderer.setSize(dimensions.width, dimensions.height);
	this.render();
};

TD.unload = function () {
	$(document).off('keydown.3d');
	$(document).off('keydown.3d-shift');
	$(document).off('keyup.3d-shift');
	if (this.renderer) {
		$(this.renderer.domElement).off('dblclick.3d');
		$(this.renderer.domElement).off('touchend.3d');
	}
	if (this.toolbar) {
		this.toolbar.destroy();
		this.toolbar = null;
	}
	if (this.mixer) {
		this.mixer.stopAllAction();
		this.mixer = null;
	}
	this.animations = [];
	this.currentAction = null;
	this.isPlaying = false;
	this.camTransition = null;

	const $threedParent = this.$container.parent('.mw-3d-wrapper');
	$threedParent.replaceWith(this.$container);
};

TD.load = function (extension, url) {
	if (this.promise) {
		this.promise.reject();
	}

	this.promise = this.loadFile(extension, url);

	this.progressBar.jumpTo(0);
	this.progressBar.animateTo(5);

	this.promise.then((result) => {
		delete this.promise;
		this.progressBar.hide();

		let object;
		if (result.scene) {
			object = result.scene;
			this.animations = result.animations || [];
			this.isGLTF = true;
		} else {
			object = result;
			this.animations = [];
			this.isGLTF = false;

			// Add directional lights for STL
			const dl1 = new THREE.DirectionalLight(0xffffff, 2);
			dl1.position.set(5, 10, 7);
			this.scene.add(dl1);
			const dl2 = new THREE.DirectionalLight(0x8888ff, 0.8);
			dl2.position.set(-5, -3, -5);
			this.scene.add(dl2);
		}

		object.castShadow = true;
		object.receiveShadow = true;
		object.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = true;
				child.receiveShadow = true;
			}
		});

		this.scene.add(object);
		this.centerAndIntro(object);

		if (this.animations.length > 0) {
			this.mixer = new THREE.AnimationMixer(object);
			this.mixer.addEventListener('finished', this.onAnimationFinished.bind(this));
			this.playAnimation(0);
		}

		this.toolbar = new ThreeDToolbar(this);
		this.toolbar.init();

		mw.threed.base.wrap(this.$container);
	}).progress((progress) => {
		this.progressBar.animateTo(progress);
	}).fail(() => {
		this.progressBar.hide();
		delete this.promise;
	});
};

TD.loadFile = function (extension, url) {
	const deferred = $.Deferred();

	switch (extension) {
		case 'gltf':
		case 'glb': {
			this.setupEnvironment();
			const gltfLoader = new THREE.GLTFLoader(this.manager);

			// KTX2 support
			const ktx2Loader = new THREE.KTX2Loader();
			ktx2Loader.setTranscoderPath(
				'https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/libs/basis/'
			);
			ktx2Loader.detectSupport(this.renderer);
			gltfLoader.setKTX2Loader(ktx2Loader);

			// Meshopt support
			gltfLoader.setMeshoptDecoder(THREE.MeshoptDecoder);

			gltfLoader.load(url, (gltf) => {
				deferred.resolve(gltf);
			}, (progress) => {
				if (progress.total > 0) {
					deferred.notify((progress.loaded / progress.total) * 100);
				}
			}, (error) => {
				deferred.reject(error);
			});
			break;
		}
		case 'stl':
		default: {
			const stlLoader = new THREE.STLLoader(this.manager);
			const request = stlLoader.load(url, (data) => {
				const object = this.geometryToObject(data);
				deferred.resolve(object);
			}, (progress) => {
				if (progress.total > 0) {
					deferred.notify((progress.loaded / progress.total) * 100);
				}
			}, (error) => {
				deferred.reject(error);
			});

			deferred.fail(() => {
				if (request && request.readyState !== 4) {
					request.abort();
				}
			});
			break;
		}
	}

	return deferred.promise();
};

// ----------------------------------------------------------------
// Animation control
// ----------------------------------------------------------------

TD.playAnimation = function (index) {
	if (!this.mixer || index < 0 || index >= this.animations.length) {
		return;
	}
	if (this.currentAction) {
		this.currentAction.stop();
	}

	this.currentTrackIndex = index;
	const clip = this.animations[index];
	this.currentAction = this.mixer.clipAction(clip);
	this.currentAction.reset();
	this.currentAction.clampWhenFinished = true;

	if (this.repeatMode === 'single') {
		this.currentAction.setLoop(THREE.LoopRepeat, Infinity);
	} else {
		this.currentAction.setLoop(THREE.LoopOnce, 1);
	}
	this.currentAction.timeScale = this.playbackSpeed;
	this.currentAction.play();
	this.isPlaying = true;

	if (this.toolbar) {
		this.toolbar.updatePlayState(true);
		this.toolbar.updateTrackUI();
	}
};

TD.onAnimationFinished = function () {
	if (this.repeatMode === 'single') {
		return;
	}
	if (this.repeatMode === 'all') {
		const next = (this.currentTrackIndex + 1) % this.animations.length;
		this.playAnimation(next);
	} else if (this.repeatMode === 'none') {
		const next = this.currentTrackIndex + 1;
		if (next < this.animations.length) {
			this.playAnimation(next);
		} else {
			this.isPlaying = false;
			if (this.toolbar) {
				this.toolbar.updatePlayState(false);
			}
		}
	}
};

TD.toggleAnimation = function () {
	if (!this.currentAction) {
		return;
	}
	if (this.isPlaying) {
		this.currentAction.paused = true;
		this.isPlaying = false;
	} else {
		if (!this.currentAction.paused && this.currentAction.time >= this.currentAction.getClip().duration) {
			this.currentAction.reset();
		}
		this.currentAction.paused = false;
		this.isPlaying = true;
	}
	if (this.toolbar) {
		this.toolbar.updatePlayState(this.isPlaying);
	}
};

TD.setPlaybackSpeed = function (speed) {
	this.playbackSpeed = speed;
	if (this.currentAction) {
		this.currentAction.timeScale = speed;
	}
};

TD.getAnimationProgress = function () {
	if (!this.currentAction) {
		return 0;
	}
	const clip = this.currentAction.getClip();
	return clip.duration > 0 ? (this.currentAction.time / clip.duration) : 0;
};

TD.seekAnimation = function (progress) {
	if (!this.currentAction) {
		return;
	}
	const clip = this.currentAction.getClip();
	this.currentAction.time = clip.duration * Math.max(0, Math.min(1, progress));
	if (!this.isPlaying) {
		this.mixer.update(0);
		this.render();
	}
};

TD.setHDTextures = function (enabled) {
	this.renderer.setPixelRatio(enabled ? window.devicePixelRatio : 1);
	this.render();
};

TD.controlsStart = function () {
	$(this.renderer.domElement).addClass('mw-mmv-canvas-mousedown');
};

TD.controlsEnd = function () {
	$(this.renderer.domElement).removeClass('mw-mmv-canvas-mousedown');
};

TD.getDimensions = function () {
	const width = $(window).width(),
		height = this.viewer.ui.canvas.$imageWrapper.height();
	return { width: width, height: height, ratio: width / height };
};

// ===========================================================================
// ThreeDToolbar
// ===========================================================================

function ThreeDToolbar(threed) {
	this.threed = threed;
	this.$container = threed.$container;
	this.fadeTimer = null;
	this.settingsOpen = false;
	this.SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];
	this.speedIndex = 3;
}

const TBP = ThreeDToolbar.prototype;

TBP.init = function () {
	this.createMainToolbar();
	if (this.threed.animations.length > 0) {
		this.createAnimationToolbar();
	}
	this.setupFadeLogic();
};

TBP.formatTime = function (seconds) {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
};

TBP.createMainToolbar = function () {
	this.$toolbar = $('<div>').addClass('mw-3d-toolbar');

	this.$settingsBtn = $('<button>')
		.addClass('mw-3d-toolbar-btn')
		.attr({ title: 'Settings' })
		.html('<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.611 3.611 0 0112 15.6z"/></svg>')
		.on('click', (e) => {
			e.stopPropagation();
			this.toggleSettings();
		});

	this.$inspectorBtn = $('<button>')
		.addClass('mw-3d-toolbar-btn')
		.attr({ title: 'Inspector (Coming soon)', disabled: true })
		.html('<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/></svg>');

	this.$toolbar.append(this.$settingsBtn, this.$inspectorBtn);

	// Settings panel
	this.$settingsPanel = $('<div>').addClass('mw-3d-settings-panel').hide();

	const settingsItems = [
		{
			icon: '⛶', label: 'Full-screen mode',
			action: this.toggleFullscreen.bind(this)
		},
		{
			icon: '◎', label: 'Focus on selection',
			action: () => this.threed.fitScene()
		},
		{
			icon: '↺', label: 'Reset camera view',
			action: () => this.threed.resetCamera()
		},
		{
			icon: 'HD', label: 'HD textures',
			toggle: true, checked: true,
			action: (checked) => this.threed.setHDTextures(checked)
		}
	];

	settingsItems.forEach((item) => {
		const $item = $('<div>').addClass('mw-3d-settings-item');

		if (item.toggle) {
			const $checkbox = $('<input>')
				.attr({ type: 'checkbox' })
				.prop('checked', item.checked)
				.on('change', function (e) {
					e.stopPropagation();
					item.action(this.checked);
				})
				.on('click', (e) => e.stopPropagation());
			const $label = $('<label>').text(item.label);
			$item.append(
				$('<span>').addClass('mw-3d-settings-icon').text(item.icon),
				$label,
				$checkbox
			).on('click', (e) => e.stopPropagation());
		} else {
			$item.append(
				$('<span>').addClass('mw-3d-settings-icon').text(item.icon),
				$('<span>').text(item.label)
			).on('click', (e) => {
				e.stopPropagation();
				item.action();
			});
		}

		this.$settingsPanel.append($item);
	});

	// Close settings when mouse leaves
	this.$settingsPanel.on('mouseleave', () => {
		if (this.settingsOpen) {
			this.closeSettings();
			this.hideToolbar();
		}
	});

	this.$container.append(this.$toolbar, this.$settingsPanel);
};

TBP.createAnimationToolbar = function () {
	const threed = this.threed;
	const names = this.threed.animations.map(
		(clip, i) => clip.name || ('Animation ' + (i + 1))
	);

	// Progress bar container
	this.$progressWrap = $('<div>').addClass('mw-3d-anim-progress-wrap');
	this.$progressFill = $('<div>').addClass('mw-3d-anim-progress-fill');
	this.$progressWrap.append(this.$progressFill);
	this.$progressWrap.on('click', (e) => {
		const rect = this.$progressWrap[0].getBoundingClientRect();
		const pct = (e.clientX - rect.left) / rect.width;
		threed.seekAnimation(pct);
	});

	this.$animToolbar = $('<div>').addClass('mw-3d-animation-toolbar');

	// LEFT GROUP
	const $leftGroup = $('<div>').addClass('mw-3d-anim-group mw-3d-anim-group-left');

	this.$playBtn = $('<button>')
		.addClass('mw-3d-anim-btn')
		.attr({ title: 'Play/Pause' })
		.html('<svg viewBox="0 0 24 24" width="18" height="18"><rect fill="currentColor" x="6" y="4" width="4" height="16"/><rect fill="currentColor" x="14" y="4" width="4" height="16"/></svg>')
		.on('click', () => threed.toggleAnimation());

	this.$timeDisplay = $('<span>').addClass('mw-3d-anim-time').text('00:00 / 00:00');

	this.$speedWrap = $('<span>')
		.addClass('mw-3d-anim-speed-wrap')
		.attr('title', 'Click to change speed')
		.html('<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-12.5l-5 7h3l-.5 4.5 5-7h-3l.5-4.5z"/></svg>');
	this.$speedText = $('<span>').addClass('mw-3d-anim-speed').text('×' + threed.playbackSpeed);
	this.$speedWrap.append(this.$speedText).on('click', () => {
		threed.speedIndex = (threed.speedIndex + 1) % threed.SPEEDS.length;
		threed.playbackSpeed = threed.SPEEDS[threed.speedIndex];
		threed.setPlaybackSpeed(threed.playbackSpeed);
		this.$speedText.text('×' + threed.playbackSpeed);
	});

	$leftGroup.append(this.$playBtn, this.$timeDisplay, this.$speedWrap);

	// CENTER GROUP
	const $centerGroup = $('<div>').addClass('mw-3d-anim-group mw-3d-anim-group-center');

	const $prevBtn = $('<button>')
		.addClass('mw-3d-anim-btn')
		.attr('title', 'Skip to previous animation')
		.html('<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>')
		.on('click', () => {
			const idx = (threed.currentTrackIndex - 1 + threed.animations.length) % threed.animations.length;
			threed.playAnimation(idx);
		});

	this.$trackSelect = $('<select>').addClass('mw-3d-anim-track-select');
	names.forEach((name, i) => {
		this.$trackSelect.append($('<option>').val(i).text(name));
	});
	this.$trackSelect.on('change', () => {
		threed.playAnimation(parseInt(this.$trackSelect.val(), 10));
	});

	const $nextBtn = $('<button>')
		.addClass('mw-3d-anim-btn')
		.attr('title', 'Skip to next animation')
		.html('<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>')
		.on('click', () => {
			const idx = (threed.currentTrackIndex + 1) % threed.animations.length;
			threed.playAnimation(idx);
		});

	$centerGroup.append($prevBtn, this.$trackSelect, $nextBtn);

	// RIGHT GROUP
	const $rightGroup = $('<div>').addClass('mw-3d-anim-group mw-3d-anim-group-right');

	this.$repeatSingleBtn = $('<button>')
		.addClass('mw-3d-anim-btn' + (threed.repeatMode === 'single' ? ' active' : ''))
		.attr('title', 'Repeat single animation')
		.html('<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/><text x="12" y="15" text-anchor="middle" font-size="7" fill="currentColor">1</text></svg>')
		.on('click', () => this.setRepeatMode('single'));

	this.$repeatAllBtn = $('<button>')
		.addClass('mw-3d-anim-btn' + (threed.repeatMode === 'all' ? ' active' : ''))
		.attr('title', 'Repeat all animations')
		.html('<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>')
		.on('click', () => this.setRepeatMode('all'));

	this.$playOnceBtn = $('<button>')
		.addClass('mw-3d-anim-btn' + (threed.repeatMode === 'none' ? ' active' : ''))
		.attr('title', 'Play all animations once and stop')
		.html('<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"/></svg>')
		.on('click', () => this.setRepeatMode('none'));

	$rightGroup.append(this.$repeatSingleBtn, this.$repeatAllBtn, this.$playOnceBtn);

	this.$animToolbar.append($leftGroup, $centerGroup, $rightGroup);

	// Wrapper for progress bar + toolbar
	this.$animWrapper = $('<div>').css({
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		zIndex: 110
	});
	this.$animWrapper.append(this.$progressWrap, this.$animToolbar);
	this.$container.append(this.$animWrapper);
};

TBP.setRepeatMode = function (mode) {
	this.threed.repeatMode = mode;
	this.$repeatSingleBtn.toggleClass('active', mode === 'single');
	this.$repeatAllBtn.toggleClass('active', mode === 'all');
	this.$playOnceBtn.toggleClass('active', mode === 'none');

	if (this.threed.currentAction) {
		if (mode === 'single') {
			this.threed.currentAction.setLoop(THREE.LoopRepeat, Infinity);
		} else {
			this.threed.currentAction.setLoop(THREE.LoopOnce, 1);
		}
	}
};

TBP.setupFadeLogic = function () {
	const fadeDelay = 3000;
	const self = this;
	let mouseOverToolbar = false;
	let mouseOverPanel = false;

	this.showToolbar = function () {
		self.$toolbar.addClass('mw-3d-toolbar-visible');
		self.resetFadeTimer();
	};

	this.hideToolbar = function () {
		if (mouseOverToolbar || mouseOverPanel || self.settingsOpen) {
			return;
		}
		self.$toolbar.removeClass('mw-3d-toolbar-visible');
		self.closeSettings();
	};

	this.resetFadeTimer = function () {
		clearTimeout(self.fadeTimer);
		self.fadeTimer = setTimeout(() => self.hideToolbar(), fadeDelay);
	};

	this.$toolbar.on('mouseenter', () => {
		mouseOverToolbar = true;
		clearTimeout(self.fadeTimer);
	}).on('mouseleave', () => {
		mouseOverToolbar = false;
		self.resetFadeTimer();
	});

	this.$settingsPanel.on('mouseenter', () => {
		mouseOverPanel = true;
		clearTimeout(self.fadeTimer);
	}).on('mouseleave', () => {
		mouseOverPanel = false;
		self.closeSettings();
		self.resetFadeTimer();
	});

	this.$container.on('mousemove.3d-toolbar', this.showToolbar);
	this.showToolbar();
};

TBP.toggleSettings = function () {
	this.settingsOpen = !this.settingsOpen;
	this.$settingsPanel.toggle(this.settingsOpen);
	this.$settingsBtn.toggleClass('mw-3d-toolbar-btn-active', this.settingsOpen);
};

TBP.closeSettings = function () {
	this.settingsOpen = false;
	this.$settingsPanel.hide();
	this.$settingsBtn.removeClass('mw-3d-toolbar-btn-active');
};

TBP.toggleFullscreen = function () {
	const container = this.$container[0];
	if (!document.fullscreenElement) {
		if (container.requestFullscreen) {
			container.requestFullscreen();
		}
	} else {
		if (document.exitFullscreen) {
			document.exitFullscreen();
		}
	}
};

TBP.updatePlayState = function (playing) {
	if (this.$playBtn) {
		if (playing) {
			this.$playBtn.html('<svg viewBox="0 0 24 24" width="18" height="18"><rect fill="currentColor" x="6" y="4" width="4" height="16"/><rect fill="currentColor" x="14" y="4" width="4" height="16"/></svg>');
		} else {
			this.$playBtn.html('<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>');
		}
	}
};

TBP.updateAnimationProgress = function () {
	if (!this.threed.currentAction) {
		return;
	}
	const clip = this.threed.currentAction.getClip();
	const t = this.threed.currentAction.time;
	const total = clip.duration;

	if (this.$timeDisplay) {
		this.$timeDisplay.text(this.formatTime(t) + ' / ' + this.formatTime(total));
	}
	if (this.$progressFill) {
		const pct = (total > 0) ? (t / total * 100) : 0;
		this.$progressFill.css('width', pct + '%');
	}
};

TBP.updateTrackUI = function () {
	if (this.$trackSelect) {
		this.$trackSelect.val(this.threed.currentTrackIndex);
	}
};

TBP.destroy = function () {
	this.$container.off('mousemove.3d-toolbar');
	clearTimeout(this.fadeTimer);
	if (this.$toolbar) {
		this.$toolbar.remove();
	}
	if (this.$settingsPanel) {
		this.$settingsPanel.remove();
	}
	if (this.$animWrapper) {
		this.$animWrapper.remove();
	} else if (this.$animToolbar) {
		this.$animToolbar.remove();
	}
};

// ===========================================================================
// Event Handling — MediaWiki MMV Integration
// ===========================================================================

$(document).on('mmv-metadata.3d', (e) => {
	const extension = e.image.filePageTitle.getExtension().toLowerCase();

	if (['stl', 'gltf', 'glb'].indexOf(extension) === -1) {
		return;
	}

	if (!singleton) {
		singleton = new ThreeD(e.viewer);
	}

	singleton.init();
	singleton.lastTime = performance.now();
	singleton.animate();
	singleton.load(extension, e.imageInfo.url);
});

$(document).on('mmv-hash mmv-cleanup-overlay', () => {
	if (singleton) {
		singleton.unload();
	}
});

mw.mmv.ThreeD = ThreeD;
mw.mmv.ThreeDToolbar = ThreeDToolbar;
