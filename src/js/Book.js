define(["co", "util", "Chapter", "BookSource"], function(co, util, Chapter, BookSource) {
    "use strict"

    // ****** Book ****
    class Book{

        constructor(bookSourceManager){

            this.bookSourceManager = bookSourceManager;

            this.name = "";  // 书名
            this.author = "";  // 作者
            this.catagory = "";  // 分类
            this.cover = "";  // 封面
            this.complete = undefined;  // 是否完结
            this.introduce = "";  // 简介

            this.sources = undefined;  // 内容来源
            this.mainSourceId = undefined;  // 当前来源
        }

        // 获取当前书籍指定的目录源信息
        getBookSource(bookSourceId=this.mainSourceId){

            return new Promise((resolve, reject) => {
                const bs = this.sources[bookSourceId];
                if(bs){
                    resolve(bs);
                }
                else{
                    const bsm = this.bookSourceManager.sources[bookSourceId];
                    if(bsm)
                    {
                        const bss = new BookSource(this, this.bookSourceManager, bookSourceId, bsm.contentSourceWeight);
                        this.sources[bookSourceId] = bss;
                        resolve(bss);
                    }
                    else{
                        reject(302);
                    }
                }
            });
        }

        // 按主源权重从大到小排序的数组
        getSourcesKeysByMainSourceWeight(){
            return this.bookSourceManager.getSourcesKeysByMainSourceWeight();
        }

        // 按内容源权重从大到小排序的数组
        getSourcesKeysByContentSourceWeight(configFileOrConfig){
            return util.objectSortedKey(this.sources, 'weight').reverse();
        }

        // 检查源是否有缺失
        checkBookSources(){
            const sources = this.bookSourceManager.sources;
            for(const k in sources){
                if(!(k in this.sources)){
                    this.sources[k] = new BookSource(this, this.bookSourceManager, k, sources[k].contentSourceWeight);
                }
            }
        }

        // 设置主源
        setMainSourceId(bookSourceId){

            return new Promise((resolve, reject) => {
                if(this.mainSourceId == bookSourceId)
                    return;

                if(bookSourceId && bookSourceId in this.bookSourceManager.sources){
                    this.mainSourceId = bookSourceId;
                    resolve(this);
                }
                else{
                    reject(301);
                }
            })
        }

        // 获取目录
        // options:
        // * forceRefresh 强制刷新
        getCatalog(forceRefresh, bookSourceId){

            return this.getBookSource(bookSourceId)
                .then(bs => bs.getCatalog(forceRefresh));
        }

        // 使用详情页链接刷新书籍信息
        // 前提：book.sources 中有详情链接
        refreshBookInfo(bookSourceId){

            return this.getBookSource(bookSourceId)
                .then(bs => bs.getBookInfo())
                .then(book => {
                        this.catagory = book.catagory;  // 分类
                        this.cover = book.cover;  // 封面
                        this.complete = book.complete;  // 是否完结
                        this.introduce = book.introduce;  // 简介
                    });
        }

        // *************************** 章节部分 ****************

        // 获取指定源的指定索引的章节
        index(chapterIndex, forceRefresh, bookSourceId){
            if(typeof chapterIndex != "number"){
                return Promise.reject(205);
            }

            if(chapterIndex < 0){
                return Promise.reject(203);
            }

            const self = this;
            return co(function*(){

                for(let i = 0; i < 2; i++){
                    const catalog = yield self.getCatalog(forceRefresh, bookSourceId);

                    if(!catalog || catalog.length <= 0){
                        return Promise.reject(501);
                    }

                    if(chapterIndex >= 0 && chapterIndex < catalog.length){
                        // 存在于目录中
                        return Promise.resolve({chapter: catalog[chapterIndex], index: chapterIndex, catalog});
                    }
                    else if(chapterIndex >= catalog.length)
                    {
                        // 超界了
                        // 没有下一章节或者目录没有更新
                        // 更新一下主目录源，然后再搜索
                        forceRefresh = true;
                    }
                    else{
                        // index < 0
                        return Promise.reject(203);
                    }
                }
                return Promise.reject(202);

            });

        }

        // 在指定的源 B 中搜索目录源的中某章节的相对应的章节
        fuzzySearch(sourceB, index, forceRefresh, bookSourceId=this.mainSourceId){

            if(bookSourceId == sourceB){
                // 两源相同
                return this.index(index, forceRefresh, sourceB);
            }

            const self = this;
            return co(function*(){
                // 获取目录源的目录
                const catalog = yield self.getCatalog(forceRefresh, bookSourceId);

                if(!catalog || catalog.length <= 0){
                    return Promise.reject(501);
                }
                // 获取源B 的目录
                for(let i = 0; i < 2; i++){

                    const catalogB = yield self.getCatalog(forceRefresh, sourceB);

                    if(!catalogB || catalogB.length <= 0){
                        return Promise.reject(501);
                    }

                    const matchs = [
                        [util.listMatch.bind(util), Chapter.equalTitle.bind(Chapter)],
                        [util.listMatchWithNeighbour.bind(util), Chapter.equalTitle.bind(Chapter)],
                        [util.listMatchWithNeighbour.bind(util), Chapter.equalTitleWithoutNum.bind(Chapter)],
                    ];

                    for(const match of matchs){
                        const [matchFunc, compareFunc] = match;
                        const indexB = matchFunc(catalog, catalogB, index, compareFunc);
                        if(indexB >= 0){
                            // 找到了
                            const chapterB = catalogB[indexB];
                            return Promise.resolve({chapter: chapterB, index: indexB, catalog: catalogB});
                        }
                        else{
                            continue;
                        }
                    }

                    // 一个也没找到
                    // 更新章节目录然后重新查找
                    forceRefresh = true;
                }
                return Promise.reject(201);
            });
        }

        // 从网上获取指定的章节
        // chapterIndex 是从主要目录源中获取的章节索引
        // options
        // * noInfluenceWeight false 是否要改变内容源的权重
        // * excludes 要排除的内容源
        // * contentSourceId 希望使用的内容源
        // * contentSourceChapterIndex 希望匹配的索引
        // * onlyCacheNoLoad 只缓存章节，不加载章节
        // * count 获取的数目，当 count == 1 时，用于前端获取并显示数据，当 count >= 1 时，用于缓存章节
        // 成功返回：章节对象，目录源章节索引，内容源，内容源章节索引
        getChapter(chapterIndex, options){

            if(chapterIndex < 0){
                return Promise.reject(203);;
            }

            options = Object.assign({}, options);
            options.bookSourceId = options.bookSourceId || this.mainSourceId;

            return this.index(chapterIndex, options.forceRefresh, options.bookSourceId)
                .then(({chapter, index, catalog}) =>
                    co(this.__getChapterFromContentSources(catalog, chapterIndex, options)));
        }

        // 按一定的算法从所有的源中找到合适的章节内容
        // options
        // * noInfluenceWeight false 是否要改变内容源的权重
        // * excludes 要排除的内容源
        // * contentSourceId 希望使用的内容源
        // * contentSourceChapterIndex 希望匹配的索引
        // * count 获取的数目
        // * onlyCacheNoLoad 只缓存章节，不加载章节
        // 成功返回：章节对象，目录源章节索引，内容源，内容源章节索引
        *__getChapterFromContentSources(catalog, index,
                {
                    bookSourceId = this.mainSourceId,
                    count = 1,
                    excludes,
                    contentSourceId,
                    contentSourceChapterIndex,
                    onlyCacheNoLoad,
                    noInfluenceWeight = false,
                    forceRefresh
                }){

            const chapterA = catalog[index];
            const result = []; // 结果的集合，按权重排序
            const errorCodeList = []; // 用于存放每次获取章节失败的原因
            let remainCount = count;// 想获取的数目

            // ***** 常量 ******
            const FOUND_WEIGHT = 0; // 找到后增加的权重
            const NOTFOUND_WEIGHT = -2; // 没找到的权重
            const EXECLUDE_WEIGHT = -4; // 排除的权重
            const INCLUDE_WEIGHT = 0; // 指定的源
            // *****************

            const self = this;

            // 如果指定的源是要排除的源，则清除之
            if(excludes && excludes.indexOf(contentSourceId) >= 0)
                contentSourceId = null;

            // 如果选项中有 contentSourceId 和 contentSourceChapterIndex，则比对指定的索引
            if(contentSourceId && typeof contentSourceChapterIndex == 'number'){
                return co(getChapterFromSelectBookSourceAndSelectSourceChapterIndex(contentSourceId, contentSourceChapterIndex))
                    .catch(handleWithNormalMethod);
            }
            else{
                return co(getChapterFromContentSources2(contentSourceId));
            }

            // 把结果添加到 Result
            function addChapterToResult(chapterB, indexB, source){
                if(!noInfluenceWeight)
                    self.sources[source].weight += FOUND_WEIGHT;
                // const chapter = new Chapter();
                // chapter.title = chapterA.title;
                // chapter.content = chapterB.content;
                result.push({
                    chapter: chapterB,
                    title: chapterA.title,
                    index: index,
                    options: {
                        contentSourceId: source,
                        contentSourceChapterIndex: indexB
                    }
                });
            }

            // 提交结果
            function submitResult(){
                if(result.length <= 0){
                    // 返回错误数最多的错误
                    let re = util.arrayCount(errorCodeList);
                    if(re.length > 0)
                        return Promise.reject(re[0][0]);
                    return Promise.reject(201);
                }
                else{
                    if(count > 1)
                        return Promise.resolve(result);
                    else{
                        return Promise.resolve(result[0]);
                    }
                }
            }

            function* getChapterFromContentSources2(includeSource){

                const contentSources = util.objectSortedKey(self.sources, 'weight'); // 按权重从小到大排序的数组
                // 去掉要排除的源
                if(excludes){
                    for(const exclude of excludes)
                    {
                        const i = contentSources.indexOf(exclude);
                        delete contentSources[i];
                        if(!noInfluenceWeight)
                            self.sources[exclude].weight += EXECLUDE_WEIGHT;
                    }
                }
                if(includeSource){
                    const i = contentSources.indexOf(includeSource);
                    delete contentSources[i];
                    // 放到结尾处
                    contentSources.push(includeSource);
                    if(!noInfluenceWeight)
                        self.sources[includeSource].weight += INCLUDE_WEIGHT;
                }

                while(contentSources.length > 0 && remainCount > 0){
                    let sourceB = contentSources.pop();

                    if(!sourceB)
                        continue;
                    try{

                        const {chapter: chapterBB, index: indexB, catalog: catalogB} = yield self.fuzzySearch(sourceB, index, forceRefresh, bookSourceId);
                        const bs = yield self.getBookSource(sourceB);
                        const chapterB = yield bs.getChapter(chapterBB, onlyCacheNoLoad);

                        // 找到了章节
                        addChapterToResult(chapterB, indexB, sourceB);
                        remainCount--;
                    }
                    catch(e){
                        errorCodeList.push(e);
                        if(!noInfluenceWeight)
                            self.sources[sourceB].weight += NOTFOUND_WEIGHT;
                    }
                }
                return submitResult();
            }


            function handleWithNormalMethod(error){
                // 失败则按正常方式获取
                // 注意网络不通的问题
                errorCodeList.push(error);
                return co(getChapterFromContentSources2());
            }

            // 从指定的源和索引中获取章节
            function* getChapterFromSelectBookSourceAndSelectSourceChapterIndex(contentSourceId, contentSourceChapterIndex){

                if(!noInfluenceWeight)
                    self.sources[contentSourceId].weight += INCLUDE_WEIGHT;

                let {chapter: chapterB, index: indexB, catalog: catalogB} = yield self.index(contentSourceChapterIndex, forceRefresh, contentSourceId);

                if(!Chapter.equalTitle(chapterA, chapterB)){
                    throw new Error();
                }

                const bs = yield self.getBookSource(contentSourceId);

                chapterB = yield bs.getChapter(chapterB, onlyCacheNoLoad);

                // 找到了章节
                addChapterToResult(chapterB, contentSourceChapterIndex, contentSourceId);
                remainCount--;
                if(remainCount > 0){
                    debugger;
                    return handleWithNormalMethod();
                }
                else{
                    return submitResult();
                }
            }
        }


        // 一次获取多个章节
        // chapterIndex 是从主要目录源中获取的章节索引
        // nextCount 获取的章节数目
        // direction 获取章节的方向，大于等于 0 则向下获取，小于 0 则向上获取
        // options
        // * noInfluenceWeight false 是否要改变内容源的权重
        // * excludes 要排除的内容源
        // * contentSourceId 希望使用的内容源
        // * contentSourceChapterIndex 希望匹配的索引
        // * count 获取的数目
        // 成功返回：章节对象，目录源章节索引，内容源，内容源章节索引
        *getChapters(chapterIndex, nextCount, direction, options){

            if(nextCount < 0) return;

            options = Object.assign({}, options);

            for(let i = 0; i < nextCount; i++){
                yield this.getChapter(chapterIndex, options);
                chapterIndex += (direction >= 0? 1 : -1);
                options.contentSourceChapterIndex += (direction >= 0? 1 : -1);
            }
        }

        // chapterIndex 是从主要目录源中获取的章节索引
        // nextCount 缓存的章节数目
        // options
        // * noInfluenceWeight false 是否要改变内容源的权重
        // * excludes 要排除的内容源
        // * contentSourceId 希望使用的内容源
        // * contentSourceChapterIndex 希望匹配的索引
        // * count 获取的数目，当 count == 1 时，用于前端获取并显示数据，当 count >= 1 时，用于缓存章节
        // 成功返回：章节对象，目录源章节索引，内容源，内容源章节索引
        cacheChapter(chapterIndex, nextCount, options){

            options = Object.assign({}, options);
            options.noInfluenceWeight = true;
            options.onlyCacheNoLoad = true;

            return co(this.getChapters(chapterIndex, nextCount, 1, options));
        }
        // *************************** 章节部分结束 ****************

        // 获取最新章节
        // 缺省强制更新
        getLastestChapter(bookSourceId){
            return this.getBookSource(bookSourceId)
                .then(bs => bs.refreshLastestChapter());
        }

    }

    // 用于标记持久化的属性
    Book.persistentInclude = ["name", "author", "catagory", "cover", "complete",
                            "introduce", "sources", "mainSourceId"];

    Book.Cast = function(obj, bookSourceManager){
        const nb = new Book(bookSourceManager);
        Object.assign(nb, obj);

        for(const bsid in nb.sources){
            const nbs = new BookSource(nb, nb.bookSourceManager, bsid);
            Object.assign(nbs, nb.sources[bsid]);
            nb.sources[bsid] = nbs;
        }
        return nb;
    }

    Book.createBook = function(obj, bookSourceManager){
        if(!obj) return undefined;

        const book = new Book(bookSourceManager);
        book.name = obj.name;  // 书名
        book.author = obj.author;// 作者

        book.catagory = obj.catagory;  // 分类
        book.cover = obj.cover; // 封面
        book.complete = obj.complete;  // 是否完结
        book.introduce = obj.introduce;  // 简介

        return book;
    };

    // 判断两本是书是否相等
    Book.equal = function(bookA, bookB){
        return bookA.name == bookB.name && bookA.author == bookB.author;
    }

    return Book;
});
