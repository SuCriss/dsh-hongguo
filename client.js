/**
 * Client half of the hongguo-drama bundle.
 *
 * The panel lives in the right column as a sidebar tab (`sidebarRightTabs` + the keyed
 * `sidebar.right.pane.tab`), so watching a drama never takes over the conversation.
 * A panel icon in the sidebar's upper list opens that tab and hands the centre back to
 * the running conversation. All data comes from this package's Host half through
 * `/hongguo-drama/api`.
 */
window.__ModuleLoader__.load({
  id: 'hongguo-drama',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const KIND = 'hongguo-drama'
    const API = '/hongguo-drama/api'

    /** Responses stay warm in the panel so switching tabs or going back is instant. */
    const CLIENT_TTL = 90 * 1000
    const CLIENT_CACHE_LIMIT = 200
    const clientCache = new Map()

    function getJson(path, ttl = CLIENT_TTL) {
      const now = Date.now()
      const hit = clientCache.get(path)
      if (hit && now - hit.at < ttl) return hit.value
      if (clientCache.size >= CLIENT_CACHE_LIMIT) {
        let oldestKey = null
        let oldestAt = Infinity
        for (const [key, entry] of clientCache) {
          if (entry.at < oldestAt) {
            oldestAt = entry.at
            oldestKey = key
          }
        }
        if (oldestKey !== null) clientCache.delete(oldestKey)
      }
      const pending = fetch(API + path).then(async (response) => {
        let payload
        try {
          payload = await response.json()
        } catch {
          payload = { error: 'HTTP ' + response.status }
        }
        if (!response.ok) throw new Error(payload?.error ?? 'HTTP ' + response.status)
        return payload
      })
      clientCache.set(path, { at: now, value: pending })
      pending.catch(() => {
        if (clientCache.get(path)?.value === pending) clientCache.delete(path)
      })
      return pending
    }

    // --------------------------------------------------------------- history --
    // One row per series: the last episode watched, where it stopped, and how far
    // through the series that is. Local to this browser profile.
    const HISTORY_KEY = 'hongguo-drama:history'
    const HISTORY_LIMIT = 100

    function readHistory() {
      try {
        const raw = localStorage.getItem(HISTORY_KEY)
        const list = raw ? JSON.parse(raw) : []
        return Array.isArray(list) ? list.filter((entry) => entry && entry.seriesId) : []
      } catch {
        return []
      }
    }

    function writeHistory(list) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_LIMIT)))
      } catch {
        /* Storage unavailable: history stays in memory for this panel. */
      }
    }

    /** Newest first, one entry per series. */
    function mergeHistory(list, record) {
      return [record].concat(list.filter((entry) => entry.seriesId !== record.seriesId)).slice(0, HISTORY_LIMIT)
    }

    function minutesOf(seconds) {
      const total = Math.max(0, Math.round(Number(seconds) || 0))
      return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0')
    }

    const CSS = `
.hg-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.hg-head{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.hg-title{font-size:13px;font-weight:600;letter-spacing:.2px;display:flex;align-items:baseline;gap:6px}
.hg-title small{font-weight:400;color:var(--dsw-alias-label-secondary);font-size:11px}
.hg-form{display:flex;gap:6px}
.hg-input{flex:1;min-width:0;height:30px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12.5px;outline:none}
.hg-input:focus{border-color:var(--dsw-alias-brand-primary)}
.hg-btn{height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12.5px;cursor:pointer;white-space:nowrap}
.hg-btn:hover{border-color:var(--dsw-alias-border-l2)}
.hg-btn[data-primary="1"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.hg-body{flex:1;min-height:0;overflow:auto;padding:10px 12px 20px}
.hg-tabs{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
.hg-tab{height:26px;padding:0 10px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1);
  background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;cursor:pointer}
.hg-tab[data-active="1"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.hg-subs{display:flex;gap:7px 8px;margin:-2px 0 10px;padding:0 2px 2px 2px;flex-wrap:wrap;
  max-height:58px;overflow-y:auto}
.hg-sub{border:none;background:none;padding:0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.hg-sub:hover{color:var(--dsw-alias-label-primary)}
.hg-sub[data-active="1"]{color:var(--dsw-alias-brand-primary);font-weight:600}
.hg-more{display:flex;justify-content:center;margin-top:14px}
.hg-more .hg-btn[disabled]{opacity:.55;cursor:default}
.hg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
.hg-card{display:flex;flex-direction:column;gap:5px;cursor:pointer;background:none;border:none;padding:0;text-align:left;color:inherit}
.hg-cover{position:relative;width:100%;aspect-ratio:3/4;border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
.hg-cover img{width:100%;height:100%;object-fit:cover;display:block}
.hg-badge{position:absolute;right:5px;bottom:5px;padding:1px 5px;border-radius:5px;font-size:10px;
  background:rgba(0,0,0,.62);color:#fff}
.hg-cname{font-size:12px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hg-cmeta{font-size:10.5px;color:var(--dsw-alias-label-secondary);line-height:1.4;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hg-empty{padding:40px 0;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.hg-err{color:var(--dsw-alias-state-error-primary);font-size:12.5px;padding:12px 0}
.hg-back{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;margin-bottom:10px;
  border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;
  color:var(--dsw-alias-label-secondary);font-size:11.5px;cursor:pointer}
.hg-back:hover{color:var(--dsw-alias-label-primary)}
.hg-detail{display:flex;gap:12px;margin-bottom:12px}
.hg-detail .hg-cover{width:104px;flex:none}
.hg-dmeta{min-width:0;display:flex;flex-direction:column;gap:6px}
.hg-dtitle{font-size:14px;font-weight:600;line-height:1.35}
.hg-tags{display:flex;gap:5px;flex-wrap:wrap}
.hg-tag{font-size:10.5px;padding:1px 7px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.hg-intro{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);max-height:86px;overflow:auto}
.hg-sec{font-size:12px;font-weight:600;margin:14px 0 8px}
.hg-eps{display:grid;grid-template-columns:repeat(auto-fill,minmax(54px,1fr));gap:6px}
.hg-eps-tall{max-height:208px;overflow:auto;padding-right:3px}
.hg-ep{height:30px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);font-size:11.5px;cursor:pointer;padding:0 2px;overflow:hidden}
.hg-ep[data-playable="0"]{color:var(--dsw-alias-state-idle-primary);background:transparent}
.hg-ep[data-current="1"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.hg-expand{width:100%;height:26px;margin-top:7px;border-radius:7px;border:1px dashed var(--dsw-alias-border-l1);
  background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;cursor:pointer}
.hg-expand:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.hg-stage{background:#000;border-radius:10px;overflow:hidden;margin:0 auto;width:100%;display:flex;justify-content:center}
.hg-stage video{display:block;width:100%;max-height:60vh;background:#000;object-fit:contain}
.hg-lock{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);padding:8px 10px;
  border-radius:9px;background:var(--dsw-alias-bg-layer-2);margin-bottom:6px}
.hg-playbar{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.hg-playbar .hg-cmeta{flex:1;min-width:0}
.hg-defsel{height:24px;padding:0 4px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:11px;cursor:pointer}
.hg-toggle{height:24px;padding:0 9px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);
  background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;white-space:nowrap}
.hg-toggle:hover{color:var(--dsw-alias-label-primary)}
.hg-toggle[data-on="1"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.hg-hist{margin-bottom:12px}
.hg-histhead{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;font-weight:600}
.hg-histmore{margin-left:auto;border:none;background:none;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400;cursor:pointer}
.hg-histmore:hover{color:var(--dsw-alias-label-primary)}
.hg-histclear{border:none;background:none;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400;cursor:pointer}
.hg-histclear:hover{color:var(--dsw-alias-label-primary)}
.hg-histrow{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.hg-histitem{flex:none;width:92px;background:none;border:none;padding:0;text-align:left;cursor:pointer;color:inherit}
.hg-histitem .hg-cover{aspect-ratio:3/4}
.hg-histprog{height:3px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);margin-top:4px;overflow:hidden}
.hg-histprog i{display:block;height:100%;background:var(--dsw-alias-brand-primary)}
.hg-hlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
.hg-hitem{position:relative}
.hg-hitem .hg-histitem{width:100%}
.hg-del{position:absolute;right:2px;top:2px;width:18px;height:18px;padding:0;border-radius:9px;border:none;
  background:rgba(0,0,0,.62);color:#fff;font-size:11px;line-height:18px;text-align:center;cursor:pointer;opacity:0}
.hg-hitem:hover .hg-del{opacity:1}
.hg-switch{display:flex;gap:6px;padding:8px 12px 0;flex:none}
.hg-switchbtn{flex:1;height:32px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12.5px;cursor:pointer}
.hg-switchbtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.hg-switchbtn[data-active="1"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff;font-weight:600}
`

    function Icon(props) {
      const size = props?.size ?? 20
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': true,
          style: { display: 'block', flex: 'none' },
        },
        h('rect', {
          x: 2.4,
          y: 4.4,
          width: 13.4,
          height: 15.2,
          rx: 3,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          opacity: props?.active ? 1 : 0.82,
        }),
        h('path', {
          d: 'M7.2 9.5h3.4M7.2 12.5h3.4M7.2 15.5h2.1',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          opacity: 0.85,
        }),
        h('circle', { cx: 18.3, cy: 8.5, r: 3, fill: 'currentColor', opacity: props?.active ? 1 : 0.7 }),
        h('path', {
          d: 'M12.8 17.4 20.5 20.8l-2.3-4.1',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
          opacity: 0.75,
        }),
      )
    }

    /** Episodes are folded to a few rows; some series run past nine hundred. */
    const EPISODE_PREVIEW = 24

    function EpisodeGrid(props) {
      const { episodes, current, onPick } = props
      const [expanded, setExpanded] = useState(false)
      const many = episodes.length > EPISODE_PREVIEW
      const shown = expanded || !many ? episodes : episodes.slice(0, EPISODE_PREVIEW)

      return h(
        'div',
        null,
        h(
          'div',
          { className: expanded ? 'hg-eps hg-eps-tall' : 'hg-eps' },
          shown.map((episode, index) =>
            h(
              'button',
              {
                key: episode.id,
                type: 'button',
                className: 'hg-ep',
                'data-current': current === index ? '1' : '0',
                title: episode.title,
                onClick: () => onPick(index),
              },
              String(index + 1),
            ),
          ),
        ),
        many
          ? h(
              'button',
              { className: 'hg-expand', type: 'button', onClick: () => setExpanded((v) => !v) },
              expanded ? '收起' : '展开全部 ' + episodes.length + ' 集',
            )
          : null,
      )
    }

    function Cover(props) {
      const { src, label } = props
      // Covers go through the Host proxy so the page never depends on the CDN origin.
      const proxied = src
        ? API + '/cover?url=' + encodeURIComponent(src)
        : null
      return h(
        'div',
        { className: 'hg-cover' },
        proxied ? h('img', { src: proxied, alt: '', loading: 'lazy' }) : null,
        label ? h('span', { className: 'hg-badge' }, label) : null,
      )
    }

    function Card(props) {
      const { item, onOpen } = props
      return h(
        'button',
        { className: 'hg-card', type: 'button', onClick: () => onOpen(item) },
        h(Cover, { src: item.cover, label: item.episodeLabel || null }),
        h('div', { className: 'hg-cname', title: item.title }, item.title),
        h(
          'div',
          { className: 'hg-cmeta' },
          (item.rank ? item.rank + '. ' : '') + (item.hot || item.tags.slice(0, 2).join(' · ')),
        ),
      )
    }

    /** Top-level sources: the crawler ranking boards plus the four category listings. */
    const SOURCES = [
      { id: 'rank', name: '热播' },
      { id: 'real-drama', name: '真人剧' },
      { id: 'comic-drama', name: '漫剧' },
      { id: 'ai-drama', name: 'AI 剧' },
      { id: 'comic', name: '漫画' },
    ]

    /** The four ranking boards, each twenty rows over five pages. */
    const RANKS = [
      { key: 'hot-drama', name: '总榜' },
      { key: 'hot-real-drama', name: '真人' },
      { key: 'hot-comic-drama', name: '漫剧' },
      { key: 'hot-ai-drama', name: 'AI' },
    ]

    const listUrl = (source, sub, page) =>
      source === 'rank'
        ? '/rank?key=' + encodeURIComponent(sub || 'hot-drama') + '&page=' + page
        : '/browse?type=' + encodeURIComponent(source) +
          (sub ? '&tag=' + encodeURIComponent(sub) : '') +
          '&page=' + page

    /** The chips shown under a source: ranking boards, or the category's genre filter. */
    const subItemsOf = (source, categories) => {
      if (source === 'rank') return RANKS
      const group = categories[source]?.[0]
      if (!group) return []
      return [{ key: '', name: '全部' }].concat(
        group.items.map((item) => ({ key: item.slug, name: item.name })),
      )
    }

    /** One "continue watching" card: resume at the recorded episode and second. */
    function HistoryCard(props) {
      const { entry, onResume } = props
      const ratio = entry.duration > 0 ? Math.min(1, (Number(entry.position) || 0) / entry.duration) : 0
      return h(
        'button',
        { className: 'hg-histitem', type: 'button', title: entry.title, onClick: () => onResume(entry) },
        h(Cover, { src: entry.cover, label: '第 ' + (entry.index + 1) + ' 集' }),
        h('div', { className: 'hg-cname' }, entry.title),
        h('div', { className: 'hg-histprog' }, h('i', { style: { width: Math.round(ratio * 100) + '%' } })),
        h(
          'div',
          { className: 'hg-cmeta' },
          '第 ' + (entry.index + 1) + '/' + entry.count + ' 集' + (ratio > 0 ? ' · ' + minutesOf(entry.position) : ''),
        ),
      )
    }

    /** Full watch history: everything kept, newest first, one row per series. */
    function HistoryView(props) {
      const { history, onResume, onRemove, onClear } = props
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'hg-histhead', style: { marginBottom: 10 } },
          h('span', null, '观看历史 · 共 ' + history.length + ' 部'),
          history.length > 0
            ? h('button', { className: 'hg-histmore', type: 'button', onClick: onClear }, '清空全部')
            : null,
        ),
        history.length === 0
          ? h('div', { className: 'hg-empty' }, '还没有观看记录，回榜单挑一部吧。')
          : h(
              'div',
              { className: 'hg-hlist' },
              history.map((entry) =>
                h(
                  'div',
                  { key: entry.seriesId, className: 'hg-hitem' },
                  h(HistoryCard, { entry, onResume }),
                  h(
                    'button',
                    {
                      className: 'hg-del',
                      type: 'button',
                      title: '从历史中删除',
                      onClick: () => onRemove(entry.seriesId),
                    },
                    '×',
                  ),
                ),
              ),
            ),
      )
    }

    function Home(props) {
      const { onOpen } = props
      const [source, setSource] = useState('rank')
      const [sub, setSub] = useState('hot-drama')
      const [categories, setCategories] = useState({})
      const [items, setItems] = useState([])
      const [page, setPage] = useState(1)
      const [hasMore, setHasMore] = useState(false)
      const [loading, setLoading] = useState(true)
      const [moreLoading, setMoreLoading] = useState(false)
      const [error, setError] = useState('')

      // Genre chips come from the category page's own filter panel.
      useEffect(() => {
        if (source === 'rank' || categories[source]) return
        let live = true
        getJson('/categories?type=' + encodeURIComponent(source))
          .then((payload) => {
            if (live) setCategories((prev) => ({ ...prev, [source]: payload.groups ?? [] }))
          })
          .catch(() => {})
        return () => {
          live = false
        }
      }, [source, categories])

      const switchSource = useCallback((next) => {
        setSource(next)
        setSub(next === 'rank' ? 'hot-drama' : '')
      }, [])

      useEffect(() => {
        let live = true
        setLoading(true)
        setError('')
        setItems([])
        setPage(1)
        setHasMore(false)
        getJson(listUrl(source, sub, 1))
          .then((payload) => {
            if (!live) return
            setItems(payload.items ?? [])
            setHasMore(Boolean(payload.hasMore))
          })
          .catch((cause) => live && setError(String(cause?.message ?? cause)))
          .finally(() => live && setLoading(false))
        return () => {
          live = false
        }
      }, [source, sub])

      const loadMore = useCallback(() => {
        if (moreLoading) return
        const next = page + 1
        setMoreLoading(true)
        getJson(listUrl(source, sub, next))
          .then((payload) => {
            setItems((prev) => prev.concat(payload.items ?? []))
            setHasMore(Boolean(payload.hasMore))
            setPage(next)
          })
          .catch((cause) => setError(String(cause?.message ?? cause)))
          .finally(() => setMoreLoading(false))
      }, [moreLoading, page, source, sub])

      const subItems = subItemsOf(source, categories)

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'hg-tabs' },
          SOURCES.map((each) =>
            h(
              'button',
              {
                key: each.id,
                type: 'button',
                className: 'hg-tab',
                'data-active': source === each.id ? '1' : '0',
                onClick: () => switchSource(each.id),
              },
              each.name,
            ),
          ),
        ),
        subItems.length > 1
          ? h(
              'div',
              { className: 'hg-subs' },
              subItems.map((each) =>
                h(
                  'button',
                  {
                    key: each.key || 'all',
                    type: 'button',
                    className: 'hg-sub',
                    'data-active': sub === each.key ? '1' : '0',
                    onClick: () => setSub(each.key),
                  },
                  each.name,
                ),
              ),
            )
          : null,
        error ? h('div', { className: 'hg-err' }, '加载失败：' + error) : null,
        loading
          ? h('div', { className: 'hg-empty' }, '正在加载…')
          : h(
              'div',
              { className: 'hg-grid' },
              items.map((item) => h(Card, { key: item.seriesId, item, onOpen })),
            ),
        !loading && items.length
          ? h(
              'div',
              { className: 'hg-more' },
              h(
                'button',
                {
                  className: 'hg-btn',
                  type: 'button',
                  disabled: !hasMore || moreLoading,
                  onClick: loadMore,
                },
                moreLoading ? '加载中…' : hasMore ? '加载更多' : '没有更多了',
              ),
            )
          : null,
      )
    }

    function Search(props) {
      const { query, onOpen } = props
      const [state, setState] = useState({ items: [], hasMore: false, total: 0 })
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const [page, setPage] = useState(1)
      const [moreLoading, setMoreLoading] = useState(false)

      useEffect(() => {
        let live = true
        setLoading(true)
        setPage(1)
        getJson('/search?q=' + encodeURIComponent(query) + '&page=1')
          .then((payload) => {
            if (!live) return
            setState(payload)
            setError('')
          })
          .catch((cause) => live && setError(String(cause?.message ?? cause)))
          .finally(() => live && setLoading(false))
        return () => {
          live = false
        }
      }, [query])

      const more = useCallback(() => {
        if (moreLoading) return
        const next = page + 1
        setMoreLoading(true)
        getJson('/search?q=' + encodeURIComponent(query) + '&page=' + next)
          .then((payload) => {
            setState((prev) => ({
              items: prev.items.concat(payload.items ?? []),
              hasMore: Boolean(payload.hasMore),
              total: payload.total ?? prev.total,
            }))
            setPage(next)
          })
          .catch((cause) => setError(String(cause?.message ?? cause)))
          .finally(() => setMoreLoading(false))
      }, [moreLoading, page, query])

      if (loading) return h('div', { className: 'hg-empty' }, '正在搜索「' + query + '」…')
      if (error) return h('div', { className: 'hg-err' }, '搜索失败：' + error)
      if (state.items.length === 0) return h('div', { className: 'hg-empty' }, '没有找到相关短剧')

      return h(
        'div',
        null,
        h('div', { className: 'hg-cmeta' }, '共 ' + state.total + ' 个结果'),
        h(
          'div',
          { className: 'hg-grid', style: { marginTop: 10 } },
          state.items.map((item) => h(Card, { key: item.seriesId, item, onOpen })),
        ),
        state.hasMore
          ? h(
              'div',
              { style: { textAlign: 'center', marginTop: 14 } },
              h(
                'button',
                {
                  className: 'hg-btn',
                  type: 'button',
                  disabled: moreLoading,
                  onClick: more,
                },
                moreLoading ? '加载中…' : '加载更多',
              ),
            )
          : null,
      )
    }

    function Detail(props) {
      const { seriesId, onPlay, onBack, resume } = props
      const [series, setSeries] = useState(null)
      const [episodes, setEpisodes] = useState([])
      const [error, setError] = useState('')
      const resumed = useRef(false)

      useEffect(() => {
        let live = true
        setSeries(null)
        setEpisodes([])
        setError('')
        getJson('/detail?series_id=' + encodeURIComponent(seriesId))
          .then((payload) => {
            if (live) setSeries(payload.series)
          })
          .catch((cause) => live && setError(String(cause?.message ?? cause)))
        // Episodes come from the SDK: the web page only publishes the first few.
        getJson('/episodes?series_id=' + encodeURIComponent(seriesId))
          .then((payload) => {
            if (live) setEpisodes(payload.items ?? [])
          })
          .catch(() => {})
        return () => {
          live = false
        }
      }, [seriesId])

      // Coming from 继续观看: jump straight to the recorded episode and second.
      useEffect(() => {
        if (!resume || resumed.current) return
        if (!series || episodes.length === 0) return
        resumed.current = true
        const at = Math.min(Math.max(Number(resume.index) || 0, 0), episodes.length - 1)
        onPlay(series, episodes, at, Number(resume.time) || 0)
      }, [resume, series, episodes, onPlay])

      if (error) return h('div', { className: 'hg-err' }, '加载失败：' + error)
      if (!series) return h('div', { className: 'hg-empty' }, '正在加载剧集…')

      return h(
        'div',
        null,
        h('button', { className: 'hg-back', type: 'button', onClick: onBack }, '← 返回'),
        h(
          'div',
          { className: 'hg-detail' },
          h(Cover, { src: series.cover }),
          h(
            'div',
            { className: 'hg-dmeta' },
            h('div', { className: 'hg-dtitle' }, series.title),
            h('div', { className: 'hg-cmeta' }, series.episodeLabel || series.episodeCount + ' 集'),
            series.tags.length
              ? h(
                  'div',
                  { className: 'hg-tags' },
                  series.tags.map((tag) => h('span', { key: tag, className: 'hg-tag' }, tag)),
                )
              : null,
            series.intro ? h('div', { className: 'hg-intro' }, series.intro) : null,
          ),
        ),
        h(
          'div',
          { className: 'hg-sec' },
          episodes.length ? '选集 · 共 ' + episodes.length + ' 集' : '选集',
        ),
        episodes.length === 0
          ? h('div', { className: 'hg-cmeta' }, '正在获取分集…')
          : h(EpisodeGrid, {
              episodes,
              onPick: (index) => onPlay(series, episodes, index),
            }),
      )
    }

    /** Auto-advance preference outlives the panel; default on. */
    const AUTONEXT_KEY = 'hongguo-drama:autonext'

    function readAutoNext() {
      try {
        return localStorage.getItem(AUTONEXT_KEY) !== '0'
      } catch {
        return true
      }
    }

    /** Last chosen definition outlives the panel; default 360p. */
    const DEFINITION_KEY = 'hongguo-drama:definition'

    function readDefinition() {
      try {
        return localStorage.getItem(DEFINITION_KEY) || '360p'
      } catch {
        return '360p'
      }
    }

    function Player(props) {
      const { series, episodes, index, onSelect, onBack, startTime, onProgress } = props
      const [failed, setFailed] = useState(false)
      const [autoNext, setAutoNext] = useState(readAutoNext)
      const [finished, setFinished] = useState(false)
      const [definition, setDefinition] = useState(readDefinition)
      const [definitions, setDefinitions] = useState([])
      const episode = episodes[index]
      const hasNext = index + 1 < episodes.length
      const videoRef = useRef(null)
      // A fullscreen <video> is destroyed when its key changes, so remember the state
      // across the auto-advance and re-request it once the next episode mounts.
      const keepFullscreen = useRef(false)

      useEffect(() => {
        setFailed(false)
        setFinished(false)
      }, [episode?.id, definition])

      useEffect(() => {
        if (!episode) return
        let live = true
        setDefinitions([])
        getJson('/streams?episode_id=' + episode.id, 60 * 1000)
          .then((payload) => {
            if (live) setDefinitions(payload.definitions ?? [])
          })
          .catch(() => {})
        return () => {
          live = false
        }
      }, [episode?.id])

      const pickDefinition = useCallback((next) => {
        setDefinition((current) => {
          if (current === next) return current
          try {
            localStorage.setItem(DEFINITION_KEY, next)
          } catch {
            /* Private mode: the choice lasts for this panel only. */
          }
          return next
        })
      }, [])

      const toggleAutoNext = useCallback(() => {
        setAutoNext((value) => {
          const next = !value
          try {
            localStorage.setItem(AUTONEXT_KEY, next ? '1' : '0')
          } catch {
            /* Private mode: the choice lasts for this panel only. */
          }
          return next
        })
      }, [])

      /** Roll into the next episode; picking it re-mounts <video> with autoPlay. */
      const handleEnded = useCallback(() => {
        setFinished(true)
        // Record fullscreen before the advancing <video> unmounts and loses it.
        keepFullscreen.current =
          Boolean(document.fullscreenElement) &&
          document.fullscreenElement === videoRef.current
        if (!autoNext || !hasNext) return
        onSelect(series, episodes, index + 1)
      }, [autoNext, hasNext, onSelect, series, episodes, index])

      /** Resume from 继续观看: seek once the duration is known. */
      const handleLoadedMetadata = useCallback(
        (event) => {
          const video = event.currentTarget
          const target = Number(startTime) || 0
          if (target <= 0 || !Number.isFinite(video.duration)) return
          if (target >= video.duration - 2) return
          try {
            video.currentTime = target
          } catch {
            /* Some decoders refuse an early seek; playback simply starts at 0. */
          }
        },
        [startTime],
      )

      /** Re-enter fullscreen after an auto-advance that remounted the <video>. */
      const handleLoadedData = useCallback(() => {
        if (!keepFullscreen.current) return
        keepFullscreen.current = false
        const video = videoRef.current
        if (!video) return
        try {
          if (video.requestFullscreen) video.requestFullscreen()
          else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen()
        } catch {
          /* Browser refused a programmatic fullscreen; stay inline. */
        }
      }, [])

      /** Write the watch position at most every 5s, and immediately on pause. */
      const lastSaved = useRef(0)
      const saveProgress = useCallback(
        (event) => {
          if (!onProgress || !episode) return
          const video = event.currentTarget
          if (!Number.isFinite(video.currentTime)) return
          const now = Date.now()
          if (event.type === 'timeupdate' && now - lastSaved.current < 5000) return
          lastSaved.current = now
          onProgress({
            seriesId: series.seriesId,
            title: series.title,
            cover: series.cover,
            index,
            episodeId: episode.id,
            count: episodes.length,
            position: video.currentTime,
            duration: Number.isFinite(video.duration) ? video.duration : 0,
          })
        },
        [onProgress, series, index, episode, episodes.length],
      )

      if (!episode) return h('div', { className: 'hg-empty' }, '正在获取分集…')

      return h(
        'div',
        null,
        h('button', { className: 'hg-back', type: 'button', onClick: onBack }, '← 返回剧集'),
        h(
          'div',
          { className: 'hg-playbar' },
          h('span', { className: 'hg-cmeta' }, series.title + ' · 第 ' + (index + 1) + ' / ' + episodes.length + ' 集'),
          definitions.length > 1
            ? h(
                'select',
                {
                  className: 'hg-defsel',
                  value: definition,
                  onChange: (event) => pickDefinition(event.target.value),
                  title: '清晰度',
                },
                definitions.map((def) => h('option', { key: def, value: def }, def)),
              )
            : null,
          h(
            'button',
            {
              className: 'hg-toggle',
              type: 'button',
              'data-on': autoNext ? '1' : '0',
              onClick: toggleAutoNext,
              title: '播完自动播放下一集',
            },
            autoNext ? '连播：开' : '连播：关',
          ),
        ),
        h(
          'div',
          { className: 'hg-stage' },
          h('video', {
            key: episode.id + ':' + definition,
            ref: videoRef,
            src: API + '/media?episode_id=' + episode.id + '&definition=' + encodeURIComponent(definition),
            controls: true,
            autoPlay: true,
            playsInline: true,
            poster: API + '/cover?url=' + encodeURIComponent(series.cover),
            onError: () => setFailed(true),
            onEnded: handleEnded,
            onLoadedMetadata: handleLoadedMetadata,
            onLoadedData: handleLoadedData,
            onTimeUpdate: saveProgress,
            onPause: saveProgress,
          }),
        ),
        failed
          ? h(
              'div',
              { className: 'hg-lock', style: { marginTop: 8 } },
              '这一集没能解出片源，换一集试试（首次播放需要解密，约几秒）。',
            )
          : null,
        finished && !hasNext
          ? h('div', { className: 'hg-lock', style: { marginTop: 8 } }, '已经是最后一集了。')
          : null,
        finished && hasNext && !autoNext
          ? h('div', { className: 'hg-lock', style: { marginTop: 8 } }, '连播已关闭：点右上「连播：关」开启，或直接选集。')
          : null,
        h('div', { className: 'hg-sec' }, '选集 · 共 ' + episodes.length + ' 集'),
        h(EpisodeGrid, {
          episodes,
          current: index,
          onPick: (at) => onSelect(series, episodes, at),
        }),
      )
    }

    function Panel() {
      const [route, setRoute] = useState({ name: 'home' })
      const [query, setQuery] = useState('')
      const [draft, setDraft] = useState('')
      const [history, setHistory] = useState(readHistory)

      const openSeries = useCallback((item) => {
        setRoute((prev) => ({
          name: 'detail',
          seriesId: item.seriesId,
          from: prev.name === 'detail' || prev.name === 'player' ? prev.from ?? 'home' : prev.name,
        }))
      }, [])
      const openEpisode = useCallback((series, episodes, index, startTime) => {
        setRoute((prev) => ({
          name: 'player',
          series,
          episodes,
          index,
          startTime: Number(startTime) || 0,
          from: prev.from ?? 'home',
        }))
      }, [])
      /** 继续观看: open the series, then let Detail jump to the saved episode. */
      const resumeEntry = useCallback((entry) => {
        setRoute((prev) => ({
          name: 'detail',
          seriesId: entry.seriesId,
          resume: { index: Number(entry.index) || 0, time: Number(entry.position) || 0 },
          from: prev.name === 'history' ? 'history' : 'home',
        }))
      }, [])
      const remember = useCallback((record) => {
        const next = mergeHistory(readHistory(), record)
        writeHistory(next)
        setHistory(next)
      }, [])
      const clearHistory = useCallback(() => {
        writeHistory([])
        setHistory([])
      }, [])
      const removeEntry = useCallback((seriesId) => {
        const next = readHistory().filter((entry) => entry.seriesId !== seriesId)
        writeHistory(next)
        setHistory(next)
      }, [])
      const submit = useCallback(
        (event) => {
          event.preventDefault()
          const next = draft.trim()
          if (next === '') return
          setQuery(next)
          setRoute({ name: 'search' })
        },
        [draft],
      )

      return h(
        'section',
        { className: 'hg-root' },
        // Rendered as a React element so unmounting removes the rules with the panel.
        h('style', { 'data-hongguo-drama': '' }, CSS),
        h(
          'header',
          { className: 'hg-head' },
          h('div', { className: 'hg-title' }, '红果短剧', h('small', null, '边聊边看')),
          h(
            'form',
            { className: 'hg-form', onSubmit: submit },
            h('input', {
              className: 'hg-input',
              value: draft,
              placeholder: '搜剧名：重生 / 太奶奶 / 战神',
              onChange: (event) => setDraft(event.target.value),
            }),
            h('button', { className: 'hg-btn', type: 'submit', 'data-primary': '1' }, '搜索'),
          ),
        ),
        route.name === 'home' || route.name === 'history'
          ? h(
              'div',
              { className: 'hg-switch' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'hg-switchbtn',
                  'data-active': route.name === 'home' ? '1' : '0',
                  onClick: () => setRoute({ name: 'home' }),
                },
                '发现',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'hg-switchbtn',
                  'data-active': route.name === 'history' ? '1' : '0',
                  onClick: () => setRoute({ name: 'history' }),
                },
                '观看历史' + (history.length ? ' · ' + history.length : ''),
              ),
            )
          : null,
        h(
          'div',
          { className: 'hg-body' },
          route.name === 'history'
            ? h(HistoryView, { history, onResume: resumeEntry, onRemove: removeEntry, onClear: clearHistory })
            : route.name === 'search'
              ? h(Search, { query, onOpen: openSeries })
              : route.name === 'detail'
                ? h(Detail, {
                    seriesId: route.seriesId,
                    resume: route.resume ?? null,
                    onPlay: openEpisode,
                    onBack: () => setRoute({ name: route.from ?? 'home' }),
                  })
                : route.name === 'player'
                  ? h(Player, {
                      series: route.series,
                      episodes: route.episodes ?? [],
                      index: route.index,
                      startTime: route.startTime ?? 0,
                      onProgress: remember,
                      onSelect: openEpisode,
                      onBack: () => setRoute({ name: 'detail', seriesId: route.series.seriesId, from: route.from }),
                    })
                  : h(Home, { onOpen: openSeries }),
        ),
      )
    }

    /** Chip title for the right column tab. */
    function TabTitle() {
      return h('span', null, '红果短剧')
    }

    /**
     * The panel-list icon is rendered by the sidebar and only receives `{ size, active }`;
     * its click dispatches this package's `main` key. This seat opens the right-column tab
     * and, when that succeeded, hands the centre back to the conversation.
     *
     * It renders the full viewer rather than a placeholder: if the right column cannot be
     * opened — or the hand-back is unavailable — the click still lands on a working page
     * instead of an empty one.
     */
    function Launcher(props) {
      const { onOpen, onHandBack } = props
      const fired = useRef(false)

      useEffect(() => {
        if (fired.current) return
        fired.current = true
        // Selecting this panel displaced the Conversation, and the right column refuses to
        // open a tab without a Session surface. Hand the centre back first, then open on a
        // later tick from the plugin's own timer, which survives this unmount.
        try {
          onHandBack()
        } catch {
          /* No layout service; the schedule below still runs. */
        }
        try {
          onOpen()
        } catch {
          /* Nothing to show here: the centre is already back on the conversation. */
        }
      }, [onOpen, onHandBack])

      return h(Panel, null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // `sidebarRight` is only visible inside an inject scope, so keep that scope's context.
        let sidebarScope = null
        ctx.effect(() => {
          const handle = ctx.inject(['sidebarRight'], (scoped) => {
            sidebarScope = scoped
          })
          return () => {
            sidebarScope = null
            handle?.dispose?.()
          }
        })

        /**
         * Activate this tab. The sidebar exposes `sidebarRight` on its own context rather
         * than a plugin's root context, so fall back the way the shipped plugin does: find
         * the chip carrying this tab's title and click it.
         */
        const clickOwnChip = () => {
          try {
            const chips = document.querySelectorAll('[role="tab"]')
            for (const chip of chips) {
              const text = (chip.textContent || '').trim()
              const label = chip.getAttribute ? chip.getAttribute('aria-label') || '' : ''
              if (text === '红果短剧' || label === '红果短剧') {
                if (chip.getAttribute('aria-selected') !== 'true') chip.click()
                return true
              }
            }
          } catch {
            /* No chip in the document yet. */
          }
          return false
        }

        const expandRightbar = () => {
          try {
            const layout = ctx.get('layout')
            if (layout && typeof layout.openRightbar === 'function') {
              layout.openRightbar(true, false)
              return true
            }
          } catch {
            /* Presentation service unavailable. */
          }
          return false
        }

        let pendingOpen = null
        ctx.effect(() => () => {
          if (pendingOpen !== null) {
            clearTimeout(pendingOpen)
            pendingOpen = null
          }
        })

        const openTabNow = () => {
          for (const host of [sidebarScope, ctx]) {
            if (!host) continue
            try {
              const controller = host.get('sidebarRight')
              if (controller && typeof controller.openTab === 'function') {
                controller.openTab(KIND)
                return true
              }
            } catch {
              // The right column has no Session surface yet; the fallback below handles it.
            }
          }
          return false
        }

        /**
         * Opening a tab requires a mounted Session surface, and the panel-list entry has
         * just displaced it. This timer belongs to the plugin, so it still fires after the
         * launcher unmounts and the Conversation is back in the centre.
         */
        const scheduleOpen = () => {
          if (pendingOpen !== null) clearTimeout(pendingOpen)
          const attempt = (delay, retriesLeft) => {
            pendingOpen = setTimeout(() => {
              pendingOpen = null
              let opened = false
              try {
                opened = openTabNow()
              } catch {
                opened = false
              }
              if (opened) return
              if (retriesLeft > 0) {
                attempt(260, retriesLeft - 1)
                return
              }
              expandRightbar()
              clickOwnChip()
            }, delay)
          }
          attempt(120, 2)
        }

        const handBackToConversation = () => {
          const layout = ctx.get('layout')
          if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null)
        }

        // Right column tab: registered through the right Sidebar's own tab registry, then
        // given its body and chip through the keyed slots that registry dispatches.
        ctx.effect(() => {
          const handle = ctx.inject(['sidebarRightTabs'], (scoped) => {
            const disposers = []
            const tabs = scoped.sidebarRightTabs
            if (!tabs || typeof tabs.register !== 'function') return
            try {
              disposers.push(
                tabs.register({
                  id: KIND,
                  kind: KIND,
                  title: () => '红果短剧',
                  guide: [
                    {
                      order: 30,
                      title: () => '红果短剧',
                      description: () => '搜索短剧、看热播榜并直接播放，不打断当前会话。',
                      icon: Icon,
                    },
                  ],
                }),
              )
              disposers.push(
                scoped.slots.inject('sidebar.right.pane.tab', () =>
                  scoped.slots.register({ name: 'sidebar.right.pane.tab', key: KIND }, Panel),
                ),
              )
              disposers.push(
                scoped.slots.inject('sidebar.right.pane.tab.title', () =>
                  scoped.slots.register({ name: 'sidebar.right.pane.tab.title', key: KIND }, TabTitle),
                ),
              )
            } catch {
              for (const dispose of disposers) dispose()
              return
            }
            return () => {
              for (const dispose of disposers) dispose()
            }
          })
          return () => {
            handle?.dispose?.()
          }
        })

        // Global panel icon in the sidebar's upper list, beside the other panels.
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: KIND, order: 40, label: '红果短剧' },
            Icon,
          ),
        )

        // The panel that icon addresses; it only borrows the centre for one frame.
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: KIND }, () =>
            h(Launcher, { onOpen: scheduleOpen, onHandBack: handBackToConversation }),
          ),
        )
      },
    }
  },
})
