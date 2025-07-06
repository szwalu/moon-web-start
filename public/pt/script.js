document.addEventListener('DOMContentLoaded', () => {
    const imageInput = document.getElementById('imageInput');
    const imageUpload = document.getElementById('imageUpload');
    const imagesList = document.getElementById('imagesList');
    const selectedCount = document.getElementById('selectedCount');
    
    let uploadedImages = [];
    let selectedImages = new Set();

    // 预设网格模板
    const gridTemplates = [
        {
            id: 'grid1x2',
            name: '1 × 2',
            rows: 1,
            cols: 2,
            cells: 2
        },
        {
            id: 'grid2x2',
            name: '2 × 2',
            rows: 2,
            cols: 2,
            cells: 4
        },
        {
            id: 'grid3x3',
            name: '3 × 3',
            rows: 3,
            cols: 3,
            cells: 9
        },
        {
            id: 'grid2x3',
            name: '2 × 3',
            rows: 2,
            cols: 3,
            cells: 6
        },
        {
            id: 'grid3x2',
            name: '3 × 2',
            rows: 3,
            cols: 2,
            cells: 6
        },
        {
            id: 'grid1x3',
            name: '1 × 3',
            rows: 1,
            cols: 3,
            cells: 3
        },
        {
            id: 'grid3x1',
            name: '3 × 1',
            rows: 3,
            cols: 1,
            cells: 3
        },
        {
            id: 'grid4x4',
            name: '4 × 4',
            rows: 4,
            cols: 4,
            cells: 16
        },
        {
            id: 'grid2x4',
            name: '2 × 4',
            rows: 2,
            cols: 4,
            cells: 8
        },
        {
            id: 'grid4x2',
            name: '4 × 2',
            rows: 4,
            cols: 2,
            cells: 8
        },
{
  id: 'grid5x_custom',
  name: '5 张布局',
  rows: 2,
  cols: 3,
  cells: 5,
  custom: true
},
{
  id: 'grid7x_custom',
  name: '7 张布局',
  rows: 2,
  cols: 4,
  cells: 7,
  custom: true
}
    ];

    let selectedTemplate = null;

    // 创建模板预览
    function createTemplatePreview(template) {
        const preview = document.createElement('div');
        preview.className = 'template-preview';
        preview.style.gridTemplateRows = `repeat(${template.rows}, 1fr)`;
        preview.style.gridTemplateColumns = `repeat(${template.cols}, 1fr)`;

        for (let i = 0; i < template.cells; i++) {
            const cell = document.createElement('div');
            cell.className = 'template-cell';
            preview.appendChild(cell);
        }

        return preview;
    }

    // 初始化模板选择区
    function initializeTemplates() {
        const templateGrid = document.querySelector('.template-grid');
        
        gridTemplates.forEach(template => {
            const templateItem = document.createElement('div');
            templateItem.className = 'template-item';
            templateItem.dataset.templateId = template.id;
            
            const preview = createTemplatePreview(template);
            templateItem.appendChild(preview);
            
            templateItem.addEventListener('click', () => {
                // 移除其他模板的选中状态
                document.querySelectorAll('.template-item.selected')
                    .forEach(item => item.classList.remove('selected'));
                
                // 选中当前模板
                templateItem.classList.add('selected');
                selectedTemplate = template;
                
                // 启用生成预览按钮
                generatePreviewBtn.disabled = false;
            });
            
            templateGrid.appendChild(templateItem);
        });
        
        // 添加生成预览按钮
        const generatePreviewBtn = document.createElement('button');
        generatePreviewBtn.className = 'generate-preview-button';
        generatePreviewBtn.textContent = '生成预览';
        generatePreviewBtn.disabled = true;
        generatePreviewBtn.onclick = updateGridPreview;

        // 将按钮添加到预览区域上方
        const previewContainer = document.querySelector('.preview-container');
        previewContainer.parentNode.insertBefore(generatePreviewBtn, previewContainer);
    }

    // 优化生成排列组合的函数，降低重复率
    function generateCombinations(arr, size) {
        if (size > arr.length) return [arr];
        const result = [];
        const maxCombinations = 6; // 限制生成6个组合
        
        // 随机打乱数组函数
        function shuffle(array) {
            const newArray = [...array];
            for (let i = newArray.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
            }
            return newArray;
        }
        
        // 计算两个组合的差异度（0-1之间，1表示完全不同）
        function calculateDifference(combo1, combo2) {
            let differences = 0;
            for (let i = 0; i < combo1.length; i++) {
                if (combo1[i] !== combo2[i]) {
                    differences++;
                }
            }
            return differences / combo1.length;
        }
        
        // 计算一个组合与现有组合的最小差异度
        function getMinDifference(newCombo) {
            if (result.length === 0) return 1;
            return Math.min(...result.map(existing => calculateDifference(existing, newCombo)));
        }
        
        // 生成一个随机组合
        function generateRandomCombination() {
            const shuffled = shuffle(arr);
            return shuffled.slice(0, size);
        }
        
        // 尝试生成不同的组合
        let attempts = 0;
        const maxAttempts = 100; // 防止无限循环
        const minDifferenceThreshold = 0.3; // 最小差异度阈值
        
        // 先添加一个初始组合
        result.push(generateRandomCombination());
        
        // 生成剩余的组合
        while (result.length < maxCombinations && attempts < maxAttempts) {
            const newCombination = generateRandomCombination();
            const minDiff = getMinDifference(newCombination);
            
            // 如果差异度大于阈值，添加这个组合
            if (minDiff > minDifferenceThreshold) {
                result.push(newCombination);
                attempts = 0; // 成功添加后重置尝试次数
            } else {
                attempts++;
            }
        }
        
        // 如果生成的组合不足6个，调整差异度阈值继续生成
        if (result.length < maxCombinations) {
            const remainingCount = maxCombinations - result.length;
            const remainingCombos = generateCombinations(arr, size)
                .filter(combo => !result.some(existing => 
                    calculateDifference(existing, combo) < 0.1
                ))
                .slice(0, remainingCount);
            
            result.push(...remainingCombos);
        }
        
        return result;
    }

    // 修改 updateGridPreview 函数
    function updateGridPreview() {
        const gridPreview = document.getElementById('gridPreview');
        const downloadBtn = document.getElementById('downloadBtn');
        const previewContainer = document.querySelector('.preview-container');
        
       // 清空样式防止切换模板出现残留
if (gridPreview && gridPreview.classList.contains('grid-preview')) {
    gridPreview.style.display = '';
    gridPreview.style.gridTemplateColumns = '';
    gridPreview.style.gridTemplateRows = '';
    gridPreview.style.gap = '';
    gridPreview.innerHTML = '';
}

        
        if (!selectedTemplate || selectedImages.size === 0) {
            gridPreview.innerHTML = '<div class="empty-preview">请选择模板和图片</div>';
            downloadBtn.disabled = true;
            return;
        }

// 自定义布局处理
if (selectedTemplate.custom) {
  const selectedImagesArray = Array.from(selectedImages).slice(0, selectedTemplate.cells);

  const previewContainer = document.querySelector('.preview-container');
  previewContainer.innerHTML = '';

  const previewSection = document.createElement('div');
  previewSection.className = 'preview-section';

  const grid = document.createElement('div');
  grid.className = 'grid-preview';
  grid.style.display = 'grid';

  // 5张图：上2下3（上大下小）
  if (selectedTemplate.id === 'grid5x_custom') {
    grid.style.gridTemplateRows = '2fr 1fr';
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    grid.style.gap = '4px';

    const layout = [
      { gridColumn: '1 / 3', gridRow: '1' },
      { gridColumn: '3 / 4', gridRow: '1' },
      { gridColumn: '1 / 2', gridRow: '2' },
      { gridColumn: '2 / 3', gridRow: '2' },
      { gridColumn: '3 / 4', gridRow: '2' },
    ];

    for (let i = 0; i < selectedImagesArray.length; i++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      Object.assign(cell.style, layout[i]);

      const img = selectedImagesArray[i].cloneNode();
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';

      const container = document.createElement('div');
      container.className = 'img-container';
      container.appendChild(img);
      cell.appendChild(container);
      grid.appendChild(cell);
    }
  }

  // 7张图：上3下4（都均分）
  if (selectedTemplate.id === 'grid7x_custom') {
    grid.style.gridTemplateRows = '1fr 1fr';
    grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
    grid.style.gap = '4px';

    const layout = [
      { gridColumn: '1 / 2', gridRow: '1' },
      { gridColumn: '2 / 3', gridRow: '1' },
      { gridColumn: '3 / 4', gridRow: '1' },
      { gridColumn: '1 / 2', gridRow: '2' },
      { gridColumn: '2 / 3', gridRow: '2' },
      { gridColumn: '3 / 4', gridRow: '2' },
      { gridColumn: '4 / 5', gridRow: '2' },
    ];

    for (let i = 0; i < selectedImagesArray.length; i++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      Object.assign(cell.style, layout[i]);

      const img = selectedImagesArray[i].cloneNode();
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';

      const container = document.createElement('div');
      container.className = 'img-container';
      container.appendChild(img);
      cell.appendChild(container);
      grid.appendChild(cell);
    }
  }

  previewSection.appendChild(grid);
  previewContainer.appendChild(previewSection);
  return; // 结束函数，防止走默认逻辑
}

        const selectedImagesArray = Array.from(selectedImages);
        
        // 生成排列组合
        const combinations = generateCombinations(
            selectedImagesArray,
            Math.min(selectedTemplate.cells, selectedImagesArray.length)
        );
        
            // ✅ 若是自定义布局模板，则调用 renderCustomLayout 并退出
const combination = generateCombinations(selectedImages, selectedTemplate.cells)[0];

// ✅ 加这段在 combination 后
if (selectedTemplate.customLayout) {
    renderCustomLayout(gridPreview, selectedTemplate, combination);
    return;
}

        // 清空预览区域前，先移除已存在的操作栏
        const existingActionBar = document.querySelector('.preview-action-bar');
        if (existingActionBar) {
            existingActionBar.remove();
        }

        // 清空预览区域
        previewContainer.innerHTML = '';
        
        // 为每个组合创建一个预览
        combinations.forEach((combination, index) => {
            const previewSection = document.createElement('div');
            previewSection.className = 'preview-section';
            
            // 添加勾选框
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'preview-checkbox';
            checkbox.onchange = () => updateDownloadButton(downloadSelectedBtn);
            
            // 添加点击预览区域选中功能
            previewSection.onclick = (e) => {
                // 如果点击的是下载按钮，不触发选中
                if (e.target.closest('.download-button')) return;
                
                checkbox.checked = !checkbox.checked;
                updateDownloadButton(downloadSelectedBtn);
                
                // 更新预览区域的选中状态
                if (checkbox.checked) {
                    previewSection.classList.add('selected');
                } else {
                    previewSection.classList.remove('selected');
                }
            };
            
            previewSection.appendChild(checkbox);
            
            const gridPreview = document.createElement('div');

            // 设置预览网格的 CSS 类名
            gridPreview.className = 'grid-preview';
            // 设置显示模式为网格布局
            gridPreview.style.display = 'grid';
            // 设置网格的行数，使用 1fr 使所有行等高
            gridPreview.style.gridTemplateRows = `repeat(${selectedTemplate.rows}, 1fr)`;
            // 设置网格的列数，使用 1fr 使所有列等宽
            gridPreview.style.gridTemplateColumns = `repeat(${selectedTemplate.cols}, 1fr)`;
            // 设置网格单元格之间的间距为 4 像素
            gridPreview.style.gap = '4px';
            // 设置网格底部外边距为 2rem
            //gridPreview.style.marginBottom = '2rem';




            
            // 填充网格
            for (let i = 0; i < selectedTemplate.cells; i++) {
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                
                if (i < combination.length) {
                    const imgContainer = document.createElement('div');
                    imgContainer.className = 'img-container';
                    
                    const img = combination[i].cloneNode();
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'cover';
                    
                    imgContainer.appendChild(img);
                    cell.appendChild(imgContainer);
                }
                
                gridPreview.appendChild(cell);
            }
            
            previewSection.appendChild(gridPreview);
            previewContainer.appendChild(previewSection);
        });

        // 添加全选和下载按钮到预览容器下方
        const actionBar = document.createElement('div');
        actionBar.className = 'preview-action-bar';
        
        const selectAllBtn = document.createElement('button');
        selectAllBtn.className = 'select-all-button';
        selectAllBtn.textContent = '全选';
        selectAllBtn.onclick = toggleSelectAll;
        
        const downloadSelectedBtn = document.createElement('button');
        downloadSelectedBtn.className = 'download-button';
        downloadSelectedBtn.textContent = '下载选中预览图';
        downloadSelectedBtn.onclick = downloadSelectedPreviews;
        downloadSelectedBtn.disabled = true;
        
        actionBar.appendChild(selectAllBtn);
        actionBar.appendChild(downloadSelectedBtn);
        
        // 将操作栏添加到预览容器后面
        previewContainer.parentNode.insertBefore(actionBar, previewContainer.nextSibling);
    }
    
function renderCustomLayout(gridPreview, template, combination) {
    gridPreview.innerHTML = '';

    // 🧩 5 张图布局：上 2 下 3（上图大）
    if (template.id === 'grid5-custom') {
        gridPreview.style.display = 'grid';
        gridPreview.style.gridTemplateColumns = '1fr 1fr 1fr';
        gridPreview.style.gridTemplateRows = '2fr 1fr';
        gridPreview.style.gap = '4px';

        const layout = [
            { gridColumn: '1 / span 2', gridRow: '1' },
            { gridColumn: '3 / span 1', gridRow: '1' },
            { gridColumn: '1 / span 1', gridRow: '2' },
            { gridColumn: '2 / span 1', gridRow: '2' },
            { gridColumn: '3 / span 1', gridRow: '2' }
        ];

        for (let i = 0; i < 5; i++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            Object.assign(cell.style, layout[i]);

            const imgContainer = document.createElement('div');
            imgContainer.className = 'img-container';

            const img = combination[i].cloneNode();
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';

            imgContainer.appendChild(img);
            cell.appendChild(imgContainer);
            gridPreview.appendChild(cell);
        }
    }

    // 🧩 7 张图布局：上 3 下 4
    if (template.id === 'grid7-custom') {
        gridPreview.style.display = 'grid';
        gridPreview.style.gridTemplateColumns = 'repeat(4, 1fr)';
        gridPreview.style.gridTemplateRows = '1fr 1fr';
        gridPreview.style.gap = '4px';

        const layout = [
            { gridColumn: '1 / span 1', gridRow: '1' },
            { gridColumn: '2 / span 1', gridRow: '1' },
            { gridColumn: '3 / span 1', gridRow: '1' },
            { gridColumn: '1 / span 1', gridRow: '2' },
            { gridColumn: '2 / span 1', gridRow: '2' },
            { gridColumn: '3 / span 1', gridRow: '2' },
            { gridColumn: '4 / span 1', gridRow: '2' }
        ];

        for (let i = 0; i < 7; i++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            Object.assign(cell.style, layout[i]);

            const imgContainer = document.createElement('div');
            imgContainer.className = 'img-container';

            const img = combination[i].cloneNode();
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';

            imgContainer.appendChild(img);
            cell.appendChild(imgContainer);
            gridPreview.appendChild(cell);
        }
    }
}

    // 修改全选/取消全选功能
    function toggleSelectAll() {
        const checkboxes = document.querySelectorAll('.preview-checkbox');
        const selectAllBtn = document.querySelector('.select-all-button');
        const isAllSelected = Array.from(checkboxes).every(cb => cb.checked);
        
        checkboxes.forEach(cb => {
            cb.checked = !isAllSelected;
            // 更新预览区域的选中状态
            const previewSection = cb.closest('.preview-section');
            if (!isAllSelected) {
                previewSection.classList.add('selected');
            } else {
                previewSection.classList.remove('selected');
            }
        });
        
        selectAllBtn.textContent = isAllSelected ? '全选' : '取消全选';
        
        // 更新下载按钮状态
        const downloadBtn = document.querySelector('.preview-action-bar .download-button');
        updateDownloadButton(downloadBtn);
    }

    // 更新下载按钮状态
    function updateDownloadButton(downloadBtn) {
        const selectedCount = document.querySelectorAll('.preview-checkbox:checked').length;
        downloadBtn.disabled = selectedCount === 0;
        downloadBtn.textContent = `下载选中预览图 (${selectedCount})`;
    }

    // 修改下载选中的预览图函数
    function downloadSelectedPreviews() {
        const selectedPreviews = document.querySelectorAll('.preview-checkbox:checked');
        
        if (selectedPreviews.length === 1) {
            // 单张下载
            const gridPreview = selectedPreviews[0].closest('.preview-section').querySelector('.grid-preview');
            createAndDownloadImage(gridPreview);
        } else {
            // 多张下载，创建 zip
            const zip = new JSZip();
            const promises = Array.from(selectedPreviews).map((checkbox, index) => {
                return new Promise(resolve => {
                    const gridPreview = checkbox.closest('.preview-section').querySelector('.grid-preview');
                    createPreviewImage(gridPreview).then(dataUrl => {
                        zip.file(`grid-image-${index + 1}.png`, dataUrl.split(',')[1], {base64: true});
                        resolve();
                    });
                });
            });

            Promise.all(promises).then(() => {
                zip.generateAsync({type: 'blob'}).then(content => {
                    const link = document.createElement('a');
                    link.download = `grid-images-${Date.now()}.zip`;
                    link.href = URL.createObjectURL(content);
                    link.click();
                });
            });
        }
    }

    // 创建预览图片（返回 Promise）
    function createPreviewImage(gridPreview) {
        return new Promise(resolve => {
            const canvas = document.createElement('canvas');
            const width = parseInt(document.getElementById('exportWidth')?.value || '1500');
const quality = parseFloat(document.getElementById('exportQuality')?.value || '0.9');

canvas.width = width;
canvas.height = (width / 3) * 4;

            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const cellWidth = canvas.width / selectedTemplate.cols;
            const cellHeight = canvas.height / selectedTemplate.rows;
            const gap = Math.floor(width / 750);

            const drawPromises = Array.from(gridPreview.querySelectorAll('.grid-cell')).map((cell, index) => {
                return new Promise((resolve) => {
                    const img = cell.querySelector('img');
                    if (!img) {
                        resolve();
                        return;
                    }

                    const row = Math.floor(index / selectedTemplate.cols);
                    const col = index % selectedTemplate.cols;
                    const x = col * (cellWidth + gap);
                    const y = row * (cellHeight + gap);

                    // 创建临时 canvas 用于裁切图片
                    const tempCanvas = document.createElement('canvas');
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCanvas.width = cellWidth;
                    tempCanvas.height = cellHeight;

                    // 计算裁切参数
                    const imgRatio = img.naturalWidth / img.naturalHeight;
                    const cellRatio = cellWidth / cellHeight;
                    let sWidth, sHeight, sx, sy;

                    if (imgRatio > cellRatio) {
                        // 图片更宽，需要裁切两边
                        sHeight = img.naturalHeight;
                        sWidth = sHeight * cellRatio;
                        sx = (img.naturalWidth - sWidth) / 2;
                        sy = 0;
                    } else {
                        // 图片更高，需要裁切上下
                        sWidth = img.naturalWidth;
                        sHeight = sWidth / cellRatio;
                        sx = 0;
                        sy = (img.naturalHeight - sHeight) / 2;
                    }

                    if (img.complete) {
                        tempCtx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, cellWidth, cellHeight);
                        ctx.drawImage(tempCanvas, x, y);
                        resolve();
                    } else {
                        img.onload = () => {
                            tempCtx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, cellWidth, cellHeight);
                            ctx.drawImage(tempCanvas, x, y);
                            resolve();
                        };
                    }
                });
            });

            Promise.all(drawPromises).then(() => {
                resolve(canvas.toDataURL('image/png'));
            });
        });
    }

    // 添加下载单个预览图的函数
function createAndDownloadImage(gridPreview) {
    const canvas = document.createElement('canvas');
    const width = parseInt(document.getElementById('exportWidth')?.value || '1500');
const quality = parseFloat(document.getElementById('exportQuality')?.value || '0.9');

canvas.width = width;
canvas.height = (width / 3) * 4;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cellWidth = canvas.width / selectedTemplate.cols;
    const cellHeight = canvas.height / selectedTemplate.rows;
    const gap = Math.floor(width / 750);

    const drawPromises = Array.from(gridPreview.querySelectorAll('.grid-cell')).map((cell, index) => {
        return new Promise((resolve) => {
            const img = cell.querySelector('img');
            if (!img) {
                resolve();
                return;
            }

            const row = Math.floor(index / selectedTemplate.cols);
            const col = index % selectedTemplate.cols;
            const x = col * (cellWidth + gap);
            const y = row * (cellHeight + gap);

            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = cellWidth;
            tempCanvas.height = cellHeight;

            const imgRatio = img.naturalWidth / img.naturalHeight;
            const cellRatio = cellWidth / cellHeight;
            let sWidth, sHeight, sx, sy;

            if (imgRatio > cellRatio) {
                sHeight = img.naturalHeight;
                sWidth = sHeight * cellRatio;
                sx = (img.naturalWidth - sWidth) / 2;
                sy = 0;
            } else {
                sWidth = img.naturalWidth;
                sHeight = sWidth / cellRatio;
                sx = 0;
                sy = (img.naturalHeight - sHeight) / 2;
            }

            if (img.complete) {
                tempCtx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, cellWidth, cellHeight);
                ctx.drawImage(tempCanvas, x, y);
                resolve();
            } else {
                img.onload = () => {
                    tempCtx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, cellWidth, cellHeight);
                    ctx.drawImage(tempCanvas, x, y);
                    resolve();
                };
            }
        });
    });

    Promise.all(drawPromises).then(() => {
const filename = `grid-image-${Date.now()}.jpg`;
canvas.toBlob(function (blob) {
    saveAs(blob, filename);
}, 'image/jpeg', quality);
    });
}

    // 初始化模板
    initializeTemplates();

    // 更新选中计数
    function updateSelectedCount() {
        selectedCount.textContent = `已选择: ${selectedImages.size}`;
    }

    // 处理文件上传
    function handleFiles(files) {
        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // 创建预览元素
                    const previewContainer = document.createElement('div');
                    previewContainer.className = 'preview-image selected';
                    
                    // 创建图片元素
                    const previewImg = document.createElement('img');
                    previewImg.src = e.target.result;
                    
                    // 创建删除按钮
                    const deleteBtn = document.createElement('div');
                    deleteBtn.className = 'delete-btn';
                    deleteBtn.innerHTML = '×';
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        const index = uploadedImages.indexOf(img);
                        if (index > -1) {
                            if (selectedImages.has(img)) {
                                selectedImages.delete(img);
                                updateSelectedCount();
                            }
                            uploadedImages.splice(index, 1);
                            previewContainer.remove();
                        }
                    };
                    
                    // 组装预览元素
                    previewContainer.appendChild(deleteBtn);
                    previewContainer.appendChild(previewImg);
                    
                    // 添加到预览列表
                    imagesList.insertBefore(previewContainer, imagesList.firstChild);
                    
                    // 保存图片对象并默认选中
                    uploadedImages.unshift(img);
                    selectedImages.add(img);
                    updateSelectedCount();
                    
                    // 如果已选择模板，启用生成预览按钮
                    const generatePreviewBtn = document.querySelector('.preview-container').previousElementSibling;
                    if (generatePreviewBtn) {
                        generatePreviewBtn.disabled = !selectedTemplate;
                    }
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // 文件输入处理
    imageInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    // 拖放处理
    imageUpload.addEventListener('dragover', (e) => {
        e.preventDefault();
        imageUpload.dataset.state = 'dragover';
    });

    imageUpload.addEventListener('dragleave', (e) => {
        e.preventDefault();
        imageUpload.dataset.state = 'empty';
    });

    imageUpload.addEventListener('drop', (e) => {
        e.preventDefault();
        imageUpload.dataset.state = 'empty';
        handleFiles(e.dataTransfer.files);
    });

    async function loadGridImage(cell, imageUrl) {
        try {
            // 创建一个临时的 canvas 元素
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // 设置预览图的尺寸（可以根据实际需求调整）
            canvas.width = 150;
            canvas.height = 150;
            
            // 创建新的图片元素
            const img = document.createElement('img');
            
            // 使用 fetch 获取图片数据
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            
            // 创建缩略图的 Blob URL
            const thumbnailUrl = URL.createObjectURL(blob);
            
            return new Promise((resolve, reject) => {
                img.onload = () => {
                    // 计算裁剪参数
                    const aspectRatio = img.naturalWidth / img.naturalHeight;
                    let sx, sy, sw, sh;
                    
                    if (aspectRatio > 1) {
                        // 横向图片
                        sh = img.naturalHeight;
                        sw = sh;
                        sx = (img.naturalWidth - sw) / 2;
                        sy = 0;
                    } else {
                        // 纵向图片
                        sw = img.naturalWidth;
                        sh = sw;
                        sx = 0;
                        sy = (img.naturalHeight - sh) / 2;
                    }
                    
                    // 在 canvas 上绘制裁剪后的图片
                    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
                    
                    // 转换为较小尺寸的 Blob
                    canvas.toBlob((thumbnailBlob) => {
                        // 释放原始的 Blob URL
                        URL.revokeObjectURL(thumbnailUrl);
                        
                        // 创建缩略图的新 URL
                        const finalThumbnailUrl = URL.createObjectURL(thumbnailBlob);
                        
                        // 设置最终的缩略图
                        const finalImg = document.createElement('img');
                        finalImg.src = finalThumbnailUrl;
                        finalImg.dataset.originalUrl = imageUrl; // 保存原始URL以供后续使用
                        cell.appendChild(finalImg);
                        
                        resolve(finalImg);
                    }, 'image/jpeg', 0.8); // 使用 JPEG 格式，质量为 0.8
                };
                
                img.onerror = reject;
                img.src = thumbnailUrl;
            });
        } catch (error) {
            console.error('加载预览图失败:', error);
        }
    }

    // 在下载完整图片时使用原始URL
    async function downloadFullImage() {
        const cells = document.querySelectorAll('.grid-cell img');
        for (const img of cells) {
            const originalUrl = img.dataset.originalUrl;
            if (originalUrl) {
                // 使用原始URL下载完整图片的逻辑
                // ...
            }
        }
    }
}); 