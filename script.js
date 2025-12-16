// ==========================================
// PART 1: GAME LOGIC (STATE & ENGINE)
// ==========================================

const scoreElement1 = document.getElementById('score1');
const scoreElement2 = document.getElementById('score2');
const gameOverElement1 = document.getElementById('gameOver1');
const gameOverElement2 = document.getElementById('gameOver2');
const pausedElement = document.getElementById('pausedMessage');
const autoModeElement1 = document.getElementById('autoModeDisplay1');
const autoModeElement2 = document.getElementById('autoModeDisplay2');
const p1GpStatusEl = document.getElementById('p1-gp-status');
const p2GpStatusEl = document.getElementById('p2-gp-status');

// Help Menu Elements
const helpScreen = document.getElementById('help-screen');
const helpTriggerButton = document.getElementById('help-trigger-button');
const closeHelpButton = document.getElementById('close-help-button');

// Game Constants
const GRID_ROWS = 20;
const GRID_COLS = 10;
const COLORS = [ null, 0xFF0000, 0x00FF00, 0x0000FF, 0x00FFFF, 0xFF00FF, 0xFFFF00, 0xFFA500 ]; // Hex numbers for Three.js
const SHAPES = [
    [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]], // I
    [[1,1,0], [0,1,1], [0,0,0]],                  // S
    [[0,1,1], [1,1,0], [0,0,0]],                  // Z
    [[1,1,1], [0,1,0], [0,0,0]],                  // T
    [[1,1], [1,1]],                               // O
    [[1,0,0], [1,1,1], [0,0,0]],                  // L
    [[0,0,1], [1,1,1], [0,0,0]]                   // J
];
const SCORES = [0, 40, 100, 300, 1200];
const AUTO_ALGO_NAMES = [ "OFF", "Center", "Left", "Right", "Random", "Smart (Bal)", "Smart (Off)", "Smart (Def)" ];

// Game State
let grid1, grid2;
let currentPiece1, currentPiece2;
let score1, score2, level1, level2;
let gameOver1, gameOver2, paused;
let autoAlgorithmIndex1, autoAlgorithmIndex2;
let lastMoveTime1, lastMoveTime2, lastFallTime1, lastFallTime2;
let moveInterval = 100, fallInterval = 500, aiMoveInterval = 80, smartAiMoveInterval = 50;
let keysPressed = {};
let gameTickCounter = 0;
let wasPausedBeforeHelp = false;

// Gamepad State
let playerGamepadAssignments = { p1: null, p2: null };
const gamepadAssignmentCooldown = {};
const gamepadInputState = {
    p1: { left: false, right: false, down: false },
    p2: { left: false, right: false, down: false }
};
const lastGamepadButtonState = { p1: [], p2: [] };

// ==========================================
// PART 2: THREE.JS RENDERER SETUP
// ==========================================
let scene, camera, renderer;
let viewP1, viewP2; // Instances of Tetris3DView

class Tetris3DView {
    constructor(offsetX, sceneRoot) {
        this.root = new THREE.Group();
        this.root.position.set(offsetX, -10, 0); // Center vertically
        sceneRoot.add(this.root);

        // Grid backing (The board container)
        const frameGeo = new THREE.BoxGeometry(GRID_COLS + 0.1, GRID_ROWS + 0.1, 1); // Slightly larger
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.set((GRID_COLS/2) - 0.5, (GRID_ROWS/2) - 0.5, -1);
        frame.receiveShadow = true;
        this.root.add(frame);
        
        // Grid Lines (Visual Helper) - Adjusted for full coverage
        const gridHelper = new THREE.GridHelper(GRID_COLS, GRID_COLS, 0x333333, 0x333333);
        gridHelper.rotation.x = Math.PI / 2;
        gridHelper.position.set((GRID_COLS/2) - 0.5, (GRID_ROWS/2) - 0.5, -0.49);
        // Scale Y to match GRID_ROWS
        gridHelper.scale.set(1, GRID_ROWS/GRID_COLS, 1);
        this.root.add(gridHelper);

        // Mesh Pool for Static Blocks (20x10)
        this.staticMeshes = [];
        const boxGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9); // Slight gap for bevel look
        
        for(let r=0; r<GRID_ROWS; r++) {
            let rowArr = [];
            for(let c=0; c<GRID_COLS; c++) {
                const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
                const mesh = new THREE.Mesh(boxGeo, mat);
                // Invert Y so 0 is top
                mesh.position.set(c, (GRID_ROWS - 1 - r), 0);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.visible = false; // Hide initially
                this.root.add(mesh);
                rowArr.push(mesh);
            }
            this.staticMeshes.push(rowArr);
        }

        // Mesh Pool for Active Piece (Max 4 blocks)
        this.activeMeshes = [];
        for(let i=0; i<4; i++) {
            const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222 });
            const mesh = new THREE.Mesh(boxGeo, mat);
            mesh.castShadow = true;
            mesh.visible = false;
            this.root.add(mesh);
            this.activeMeshes.push(mesh);
        }
    }

    update(grid, activePiece) {
        // 1. Update Static Grid
        for(let r=0; r<GRID_ROWS; r++) {
            for(let c=0; c<GRID_COLS; c++) {
                const colorVal = grid[r][c];
                const mesh = this.staticMeshes[r][c];
                if(colorVal !== 0) {
                    mesh.visible = true;
                    mesh.material.color.setHex(colorVal);
                } else {
                    mesh.visible = false;
                }
            }
        }

        // 2. Update Active Piece
        // Hide all first
        this.activeMeshes.forEach(m => m.visible = false);

        if(activePiece && activePiece.shape) {
            let meshIdx = 0;
            activePiece.shape.forEach((row, r) => {
                row.forEach((cell, c) => {
                    if(cell && meshIdx < 4) {
                        const mesh = this.activeMeshes[meshIdx];
                        mesh.visible = true;
                        mesh.material.color.setHex(activePiece.color);
                        // Calculate world pos relative to board root
                        const gridX = activePiece.col + c;
                        const gridY = activePiece.row + r;
                        
                        // Prevent drawing outside bounds purely visual
                        if(gridY >= 0 && gridY < GRID_ROWS) {
                            mesh.position.set(gridX, (GRID_ROWS - 1 - gridY), 0);
                        } else {
                            mesh.visible = false; // Above board
                        }
                        meshIdx++;
                    }
                });
            });
        }
    }
}

function initThreeJS() {
    const container = document.getElementById('three-container');
    
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
    // Add some fog for depth
    scene.fog = new THREE.Fog(0x111111, 20, 60);

    // Camera
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    camera.position.set(0, 0, 35); // Look from center

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 20, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    const spotLight = new THREE.SpotLight(0x00ccff, 0.8);
    spotLight.position.set(0, 30, 10);
    spotLight.lookAt(0,0,0);
    scene.add(spotLight);

    // Create Boards (Offset Left and Right)
    // Board is approx 10 units wide. Center is 5.
    // Shift P1 left by ~8 units, P2 right by ~8 units relative to center.
    // Since coords are 0..10 inside the group, we need to offset the group.
    
    // Player 1 (Left) - Shift Left by 12, then center the 10-width board (move back by 5)
    viewP1 = new Tetris3DView(-12, scene); 
    // Player 2 (Right)
    viewP2 = new Tetris3DView(2, scene);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(100, 50);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.8, metalness: 0.5 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -11; // Just below the boards
    floor.receiveShadow = true;
    scene.add(floor);

    // Handle Resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}


// ==========================================
// PART 3: LOGIC IMPLEMENTATION
// ==========================================

function init() {
    // 3D Setup
    initThreeJS();

    // Logic Setup
    grid1 = createGrid(GRID_ROWS, GRID_COLS);
    grid2 = createGrid(GRID_ROWS, GRID_COLS);

    currentPiece1 = createTetrimino();
    if (currentPiece1) currentPiece1.col = Math.floor(GRID_COLS / 2) - Math.floor(getShapeWidth(currentPiece1.shape) / 2);
    currentPiece2 = createTetrimino();
    if (currentPiece2) currentPiece2.col = Math.floor(GRID_COLS / 2) - Math.floor(getShapeWidth(currentPiece2.shape) / 2);

    score1 = 0; score2 = 0; level1 = 1; level2 = 1;
    gameOver1 = false; gameOver2 = false; paused = false;
    autoAlgorithmIndex1 = 7; // Default to Smart (Def) for P1
    autoAlgorithmIndex2 = 0; // Default to OFF for P2
    gameTickCounter = 0;
    lastMoveTime1 = 0; lastMoveTime2 = 0; lastFallTime1 = 0; lastFallTime2 = 0;
    keysPressed = {};

    updateScoreDisplays();
    updateAutoModeDisplays();
    updateGamepadStatusHUD();
    gameOverElement1.style.display = 'none';
    gameOverElement2.style.display = 'none';
    pausedElement.style.display = 'none';

    requestAnimationFrame(gameLoop);
}

// --- Game Loop ---
let lastTime = 0;
function gameLoop(currentTime) {
    gameTickCounter++;
    if (!lastTime) lastTime = currentTime;
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;

    pollGamepads(currentTime);
    handleInput(currentTime);

    if (!paused) {
        if (!gameOver1) updatePlayer(1, currentTime, grid1, currentPiece1, (p) => currentPiece1 = p);
        if (!gameOver2) updatePlayer(2, currentTime, grid2, currentPiece2, (p) => currentPiece2 = p);
    }

    // RENDER 3D
    viewP1.update(grid1, gameOver1 ? null : currentPiece1);
    viewP2.update(grid2, gameOver2 ? null : currentPiece2);
    renderer.render(scene, camera);

    requestAnimationFrame(gameLoop);
}

// Refactored Update Logic per Player to reduce duplication
function updatePlayer(pIdx, currentTime, grid, piece, setPiece) {
    let lastFall = pIdx === 1 ? lastFallTime1 : lastFallTime2;
    
    if (currentTime - lastFall > fallInterval) {
        if (checkCollision(grid, piece, 1, 0)) {
            mergeTetrimino(grid, piece);
            const linesCleared = clearFullRows(grid);
            if(pIdx === 1) score1 += SCORES[linesCleared] * level1;
            else score2 += SCORES[linesCleared] * level2;
            
            if (linesCleared > 0) updateScoreDisplays();
            
            let newPiece = createTetrimino();
            if (newPiece) {
                newPiece.col = Math.floor(GRID_COLS / 2) - Math.floor(getShapeWidth(newPiece.shape) / 2);
                newPiece.smartTargetComputed = false;
                setPiece(newPiece);
                if (checkCollision(grid, newPiece, 0, 0)) { triggerGameOver(pIdx); }
            } else { triggerGameOver(pIdx); }
        } else {
            piece.row++;
        }
        if(pIdx === 1) lastFallTime1 = currentTime; else lastFallTime2 = currentTime;
    }
}

function triggerGameOver(pNum) {
    if(pNum === 1) { gameOver1 = true; gameOverElement1.style.display = 'block'; }
    else { gameOver2 = true; gameOverElement2.style.display = 'block'; }
}

// --- Input Handling ---
function handleInput(currentTime) {
    // Player 1
    if (!gameOver1 && currentPiece1) {
        if (autoAlgorithmIndex1 === 0) { // Manual P1
            if (currentTime - lastMoveTime1 > moveInterval) {
                let moved = false;
                const p1Gp = gamepadInputState.p1;
                if ((keysPressed['arrowleft'] || p1Gp.left) && !checkCollision(grid1, currentPiece1, 0, -1)) { currentPiece1.col--; moved = true; }
                if ((keysPressed['arrowright'] || p1Gp.right) && !checkCollision(grid1, currentPiece1, 0, 1)) { currentPiece1.col++; moved = true; }
                if ((keysPressed['arrowdown'] || p1Gp.down) && !checkCollision(grid1, currentPiece1, 1, 0)) {
                    currentPiece1.row++; lastFallTime1 = currentTime; moved = true;
                }
                if (moved) lastMoveTime1 = currentTime;
            }
        } else if (autoAlgorithmIndex1 >= 5) { // Smart AI
            const res = smartAiMove(grid1, currentPiece1, currentTime, lastMoveTime1, smartAiMoveInterval, lastFallTime1, autoAlgorithmIndex1);
            lastMoveTime1 = res.newLastMoveTime;
        } else { // Simple AI
            lastMoveTime1 = autoPlayMove(grid1, currentPiece1, currentTime, lastMoveTime1, aiMoveInterval, autoAlgorithmIndex1);
        }
    }

    // Player 2
    if (!gameOver2 && currentPiece2) {
        if (autoAlgorithmIndex2 === 0) { // Manual P2
            if (currentTime - lastMoveTime2 > moveInterval) {
                let moved = false;
                const p2Gp = gamepadInputState.p2;
                if ((keysPressed['a'] || p2Gp.left) && !checkCollision(grid2, currentPiece2, 0, -1)) { currentPiece2.col--; moved = true; }
                if ((keysPressed['d'] || p2Gp.right) && !checkCollision(grid2, currentPiece2, 0, 1)) { currentPiece2.col++; moved = true; }
                if ((keysPressed['s'] || p2Gp.down) && !checkCollision(grid2, currentPiece2, 1, 0)) {
                    currentPiece2.row++; lastFallTime2 = currentTime; moved = true;
                }
                if (moved) lastMoveTime2 = currentTime;
            }
        } else if (autoAlgorithmIndex2 >= 5) {
             const res = smartAiMove(grid2, currentPiece2, currentTime, lastMoveTime2, smartAiMoveInterval, lastFallTime2, autoAlgorithmIndex2);
            lastMoveTime2 = res.newLastMoveTime;
        } else {
            lastMoveTime2 = autoPlayMove(grid2, currentPiece2, currentTime, lastMoveTime2, aiMoveInterval, autoAlgorithmIndex2);
        }
    }
}

// --- Logic Helpers ---
function createGrid(rows, cols) { return Array.from({ length: rows }, () => Array(cols).fill(0)); }
function getRandomElement(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function getShapeWidth(shape) { 
    if (!shape || shape.length === 0) return 0;
    let minC = GRID_COLS, maxC = -1;
    shape.forEach((row, r) => {
        row.forEach((cell, c) => {
            if (cell) {
                minC = Math.min(minC, c);
                maxC = Math.max(maxC, c);
            }
        });
    });
    return maxC - minC + 1;
}
function getShapeHeight(shape) { 
    if (!shape || shape.length === 0) return 0;
    let minR = GRID_ROWS, maxR = -1;
    shape.forEach((row, r) => {
        row.forEach((cell, c) => {
            if (cell) {
                minR = Math.min(minR, r);
                maxR = Math.max(maxR, r);
            }
        });
    });
    return maxR - minR + 1;
}

function createTetrimino() {
    const blueprintShape = getRandomElement(SHAPES);
    const colorIndex = Math.floor(Math.random() * (COLORS.length - 1)) + 1;
    const newShape = blueprintShape.map(row => [...row]);
    return { shape: newShape, color: COLORS[colorIndex], row: 0, col: 0, smartTargetComputed: false, smartTargetCol: null, smartTargetRotations: 0 };
}

function rotateSinglePiece(piece) {
    const shape = piece.shape;
    const N = shape.length; 
    if(!N) return piece.shape;
    const M = shape[0].length;
    const rotated = Array.from({length: M}, () => Array(N).fill(0));

    for (let r = 0; r < N; r++) {
        for (let c = 0; c < M; c++) {
            rotated[c][N - 1 - r] = shape[r][c];
        }
    }
    return rotated;
}
// Helper to rotate active piece safely
function tryRotate(grid, piece) {
    if (!piece || !piece.shape) return;
    const oldShape = piece.shape;
    const oldCol = piece.col;
    
    let newShape = oldShape;
    for(let i=0; i<1; i++) { // Only one rotation attempt for manual control
        newShape = rotateSinglePiece({shape: newShape}).slice();
    }

    // Test basic rotation
    piece.shape = newShape;
    if(!checkCollision(grid, piece, 0, 0)) {
        if(piece.smartTargetComputed) piece.smartTargetComputed = false;
        return;
    }
    
    // Wall Kicks (Simple)
    const kicks = [-1, 1, -2, 2];
    for (let k of kicks) {
        piece.col = oldCol + k;
        if (!checkCollision(grid, piece, 0, 0)) {
            if(piece.smartTargetComputed) piece.smartTargetComputed = false;
            return; // Successful kick
        }
    }

    // Revert if failed
    piece.shape = oldShape;
    piece.col = oldCol;
}

function checkCollision(grid, piece, rowOffset, colOffset) {
    if (!piece || !piece.shape) return true;
    for (let r = 0; r < piece.shape.length; r++) {
        for (let c = 0; c < piece.shape[r].length; c++) {
            if (piece.shape[r][c]) {
                const newRow = piece.row + r + rowOffset;
                const newCol = piece.col + c + colOffset;
                if (newRow < 0 || newRow >= GRID_ROWS || newCol < 0 || newCol >= GRID_COLS) return true;
                if (grid[newRow][newCol] !== 0) return true;
            }
        }
    }
    return false;
}

function mergeTetrimino(grid, piece) {
    piece.shape.forEach((row, r) => {
        row.forEach((cell, c) => {
            if (cell) {
                const mergeRow = piece.row + r;
                const mergeCol = piece.col + c;
                if (mergeRow >= 0 && mergeRow < GRID_ROWS && mergeCol >=0 && mergeCol < GRID_COLS) {
                    grid[mergeRow][mergeCol] = piece.color;
                }
            }
        });
    });
}

function clearFullRows(grid) {
    let linesCleared = 0;
    for (let r = GRID_ROWS - 1; r >= 0; ) {
        if (grid[r].every(cell => cell !== 0)) {
            grid.splice(r, 1);
            grid.unshift(Array(GRID_COLS).fill(0));
            linesCleared++;
        } else { r--; }
    }
    return linesCleared;
}

function hardDrop(pIdx, currentTime) {
    let grid = pIdx === 1 ? grid1 : grid2;
    let piece = pIdx === 1 ? currentPiece1 : currentPiece2;
    if(pIdx === 1 && gameOver1) return;
    if(pIdx === 2 && gameOver2) return;
    if(!piece) return;

    while (!checkCollision(grid, piece, 1, 0)) { piece.row++; }
    
    // Force immediate update next loop
    if(pIdx === 1) lastFallTime1 = -1000; 
    else lastFallTime2 = -1000;
}

function updateScoreDisplays() {
    scoreElement1.textContent = score1;
    scoreElement2.textContent = score2;
}

function updateAutoModeDisplays() {
    autoModeElement1.textContent = AUTO_ALGO_NAMES[autoAlgorithmIndex1];
    autoModeElement2.textContent = AUTO_ALGO_NAMES[autoAlgorithmIndex2];
}

// --- AI Logic ---
function autoPlayMove(grid, piece, currentTime, lastMoveTime, moveSpeed, algoIdx) {
    if (currentTime - lastMoveTime > moveSpeed) {
        let moved = false;
        // Simple heuristic Logic
        if(algoIdx === 1) { // Center
            const target = Math.floor(GRID_COLS/2)-1;
            if(piece.col < target && !checkCollision(grid, piece, 0, 1)) { piece.col++; moved=true;}
            else if(piece.col > target && !checkCollision(grid, piece, 0, -1)) { piece.col--; moved=true;}
        } 
        else if (algoIdx === 4 || algoIdx === 2 || algoIdx === 3) { // Random/Left/Right
            let dir = algoIdx === 2 ? -1 : (algoIdx === 3 ? 1 : (Math.random()>0.5?1:-1));
            if(!checkCollision(grid, piece, 0, dir)) { piece.col += dir; moved = true; }
            if(Math.random() < 0.1) tryRotate(grid, piece);
        }
        if(moved) return currentTime;
    }
    return lastMoveTime;
}


/**
 * Calculates a heuristic score for a given board state.
 * @param {Array<Array<number>>} board The game grid.
 * @returns {number} The heuristic score. Lower is better.
 */
function evaluateBoard(board) {
    let score = 0;
    let maxHeight = 0;
    let holes = 0;
    let bumpiness = 0;
    let heights = Array(GRID_COLS).fill(0);

    for (let c = 0; c < GRID_COLS; c++) {
        let colHeight = 0;
        let foundBlock = false;
        for (let r = 0; r < GRID_ROWS; r++) {
            if (board[r][c] !== 0) {
                if (!foundBlock) {
                    colHeight = GRID_ROWS - r;
                    foundBlock = true;
                }
            } else if (foundBlock) {
                holes++; // Found a hole beneath a block
            }
        }
        heights[c] = colHeight;
        maxHeight = Math.max(maxHeight, colHeight);
    }

    // Calculate bumpiness
    for (let c = 0; c < GRID_COLS - 1; c++) {
        bumpiness += Math.abs(heights[c] - heights[c + 1]);
    }

    // Weights for the heuristic components (can be tuned)
    const WEIGHT_HEIGHT = -0.5;
    const WEIGHT_LINES = 1.0; // Lines cleared are handled separately when scoring
    const WEIGHT_HOLES = -1.0;
    const WEIGHT_BUMPINESS = -0.2;

    score += maxHeight * WEIGHT_HEIGHT;
    score += holes * WEIGHT_HOLES;
    score += bumpiness * WEIGHT_BUMPINESS;

    return score;
}

/**
 * Simulates hard dropping a piece onto a grid.
 * @param {Array<Array<number>>} initialGrid The grid before dropping.
 * @param {object} piece The piece to drop (with its current shape, row, col).
 * @returns {object} An object containing the new grid and lines cleared.
 */
function simulateHardDrop(initialGrid, piece) {
    let tempGrid = initialGrid.map(row => [...row]); // Deep copy
    let tempPiece = { ...piece };

    // Find the final row after hard drop
    while (!checkCollision(tempGrid, tempPiece, 1, 0)) {
        tempPiece.row++;
    }

    // Merge the piece into the temporary grid
    mergeTetrimino(tempGrid, tempPiece);

    // Clear lines and get count
    let linesCleared = 0;
    for (let r = GRID_ROWS - 1; r >= 0; ) {
        if (tempGrid[r].every(cell => cell !== 0)) {
            tempGrid.splice(r, 1);
            tempGrid.unshift(Array(GRID_COLS).fill(0));
            linesCleared++;
        } else {
            r--;
        }
    }
    return { grid: tempGrid, linesCleared: linesCleared };
}

/**
 * Calculates the best move (rotation and column) for the current piece.
 * @param {Array<Array<number>>} grid The current game grid.
 * @param {object} piece The current falling piece.
 * @returns {object} An object with bestRotations, bestCol, and bestScore.
 */
function calculateBestMove(grid, piece) {
    let bestScore = -Infinity;
    let bestRotations = 0;
    let bestCol = 0;

    for (let r = 0; r < 4; r++) { // Iterate through 0 to 3 rotations
        let rotatedPiece = { ...piece, shape: piece.shape };
        for (let i = 0; i < r; i++) {
            rotatedPiece.shape = rotateSinglePiece(rotatedPiece);
        }

        // Test all possible column placements for this rotation
        // The piece's `col` can range from a negative value (off-screen left)
        // to `GRID_COLS - getShapeWidth(piece.shape)`
        for (let c = -getShapeWidth(rotatedPiece.shape); c < GRID_COLS; c++) {
            let testPiece = { ...rotatedPiece, row: 0, col: c };

            // Check if piece is valid at this column and rotation
            // We need to temporarily set its row to a valid position to check
            // collision, then find the actual drop row.
            
            // First, try to place it at row 0 (or slightly negative if it spawns high)
            // If it collides at row 0, it's not a valid starting position
            if (checkCollision(grid, testPiece, 0, 0)) {
                // Adjust for pieces that spawn partially above the grid
                let foundValidStart = false;
                for(let startRow = 0; startRow >= -getShapeHeight(testPiece.shape); startRow--) {
                    let tempTestPiece = {...testPiece, row: startRow};
                    if(!checkCollision(grid, tempTestPiece, 0, 0)) {
                        testPiece.row = startRow;
                        foundValidStart = true;
                        break;
                    }
                }
                if (!foundValidStart) continue; // Cannot place this rotation/column combination at all
            }


            // Simulate hard drop and evaluate the resulting board
            let simulatedResult = simulateHardDrop(grid, testPiece);
            let currentScore = evaluateBoard(simulatedResult.grid);

            // Add score for lines cleared
            currentScore += simulatedResult.linesCleared * 1000; // Large reward for lines cleared

            // Implement different AI personalities
            if (autoAlgorithmIndex1 === 6 || autoAlgorithmIndex2 === 6) { // Smart (Offensive)
                // Offensive AI prioritizes lines cleared, less concern for holes/height
                currentScore += simulatedResult.linesCleared * 5000;
                currentScore -= evaluateBoard(simulatedResult.grid) * 0.5; // Less penalty for bad board state
            } else if (autoAlgorithmIndex1 === 7 || autoAlgorithmIndex2 === 7) { // Smart (Defensive)
                // Defensive AI prioritizes a flat board and avoiding holes
                currentScore += simulatedResult.linesCleared * 2000;
                currentScore -= evaluateBoard(simulatedResult.grid) * 1.5; // More penalty for bad board state
            }


            if (currentScore > bestScore) {
                bestScore = currentScore;
                bestRotations = r;
                bestCol = c;
            }
        }
    }
    return { bestRotations, bestCol, bestScore };
}


function smartAiMove(grid, piece, currentTime, lastMoveTime, moveSpeed, fallTime, algo) {
    if (!piece.smartTargetComputed) {
        const { bestRotations, bestCol } = calculateBestMove(grid, piece);
        piece.smartTargetRotations = bestRotations;
        piece.smartTargetCol = bestCol;
        piece.smartTargetComputed = true;
    }

    if (currentTime - lastMoveTime > moveSpeed) {
        let moved = false;

        // Apply rotations
        if (piece.smartTargetRotations > 0) {
            piece.shape = rotateSinglePiece(piece);
            piece.smartTargetRotations--;
            moved = true;
        } 
        // Move horizontally
        else if (piece.col !== piece.smartTargetCol) {
            if (piece.col < piece.smartTargetCol && !checkCollision(grid, piece, 0, 1)) {
                piece.col++;
                moved = true;
            } else if (piece.col > piece.smartTargetCol && !checkCollision(grid, piece, 0, -1)) {
                piece.col--;
                moved = true;
            }
        } else {
            // Once in position, hard drop
            hardDrop(piece === currentPiece1 ? 1 : 2, currentTime);
            moved = true; // Signifies that the AI has completed its turn
            // Reset for next piece
            piece.smartTargetComputed = false;
        }

        if (moved) return { newLastMoveTime: currentTime };
    }
    return { newLastMoveTime: lastMoveTime };
}


// --- Gamepad ---
function pollGamepads(currentTime) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (!pads) return;

    for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (!pad || gamepadAssignmentCooldown[i]) continue;
        const pressed = pad.buttons.some(b => b.pressed);
        if (pressed) {
            if (playerGamepadAssignments.p1 === null && playerGamepadAssignments.p2 !== i) {
                playerGamepadAssignments.p1 = i; gamepadAssignmentCooldown[i] = true;
                setTimeout(() => delete gamepadAssignmentCooldown[i], 1000);
            } else if (playerGamepadAssignments.p2 === null && playerGamepadAssignments.p1 !== i) {
                playerGamepadAssignments.p2 = i; gamepadAssignmentCooldown[i] = true;
                setTimeout(() => delete gamepadAssignmentCooldown[i], 1000);
            }
            updateGamepadStatusHUD();
        }
    }
    
    // Process P1
    if (playerGamepadAssignments.p1 !== null) processGamepad(1, pads[playerGamepadAssignments.p1], currentTime);
    // Process P2
    if (playerGamepadAssignments.p2 !== null) processGamepad(2, pads[playerGamepadAssignments.p2], currentTime);
}

function processGamepad(pIdx, pad, time) {
    if(!pad || paused) return;
    const state = pIdx===1?gamepadInputState.p1:gamepadInputState.p2;
    state.left = pad.axes[0] < -0.5 || pad.buttons[14]?.pressed;
    state.right = pad.axes[0] > 0.5 || pad.buttons[15]?.pressed;
    state.down = pad.axes[1] > 0.5 || pad.buttons[13]?.pressed;

    const btnState = pIdx===1?lastGamepadButtonState.p1:lastGamepadButtonState.p2;
    const grid = pIdx===1?grid1:grid2;
    const piece = pIdx===1?currentPiece1:currentPiece2;

    // Rotate (A=0)
    if(pad.buttons[0]?.pressed && !btnState[0]) tryRotate(grid, piece);
    // Hard Drop (X=2)
    if(pad.buttons[2]?.pressed && !btnState[2]) hardDrop(pIdx, time);

    btnState[0] = pad.buttons[0]?.pressed;
    btnState[2] = pad.buttons[2]?.pressed;
}

function updateGamepadStatusHUD() {
    p1GpStatusEl.textContent = playerGamepadAssignments.p1 !== null ? `GP: Connected` : 'GP: N/A';
    p2GpStatusEl.textContent = playerGamepadAssignments.p2 !== null ? `GP: Connected` : 'GP: N/A';
}

// --- Listeners ---
document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    
    if (key === 'h') {
        if(helpScreen.classList.contains('hidden')) {
            wasPausedBeforeHelp = paused;
            paused = true;
            helpScreen.classList.remove('hidden');
            pausedElement.style.display = 'block';
        } else {
            paused = wasPausedBeforeHelp;
            helpScreen.classList.add('hidden');
            if(!paused) pausedElement.style.display = 'none';
        }
        return;
    }
    if (!helpScreen.classList.contains('hidden')) return;

    if (key === 'p') {
        paused = !paused;
        pausedElement.style.display = paused ? 'block' : 'none';
        if(!paused) lastTime = performance.now();
        return;
    }

    if (key === 't') { 
        autoAlgorithmIndex1 = (autoAlgorithmIndex1 + 1) % AUTO_ALGO_NAMES.length; 
        currentPiece1.smartTargetComputed = false; // Reset AI target on mode change
        updateAutoModeDisplays(); 
        return; 
    }
    if (key === 'u') { 
        autoAlgorithmIndex2 = (autoAlgorithmIndex2 + 1) % AUTO_ALGO_NAMES.length; 
        currentPiece2.smartTargetComputed = false; // Reset AI target on mode change
        updateAutoModeDisplays(); 
        return; 
    }

    if(paused) return;

    const t = performance.now();
    keysPressed[key] = true;

    if (key === 'arrowup' && !gameOver1) tryRotate(grid1, currentPiece1);
    if (key === 'w' && !gameOver2) tryRotate(grid2, currentPiece2);
    if (key === 'e') hardDrop(1, t);
    if (key === 'r') hardDrop(2, t);
});

document.addEventListener('keyup', (e) => delete keysPressed[e.key.toLowerCase()]);

helpTriggerButton.addEventListener('click', () => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'h'})));
closeHelpButton.addEventListener('click', () => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'h'})));

// Start
document.addEventListener('DOMContentLoaded', init);
