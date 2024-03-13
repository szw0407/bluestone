import {ReactEditor} from 'slate-react'
import {useGetSetState} from 'react-use'
import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef} from 'react'
import {mediaType} from '../utils/dom'
import {useSelStatus} from '../../hooks/editor'
import {Transforms} from 'slate'
import {getImageData, nid} from '../../utils'
import {ElementProps, MediaNode} from '../../el'
import {isAbsolute, join} from 'path'
import {EditorUtils} from '../utils/editorUtils'
import {getRemoteMediaType} from '../utils/media'
import {Icon} from '@iconify/react'
import {MainApi} from '../../api/main'
import {writeFileSync} from 'fs'
import {getVisibleStyle, useMonitorHeight} from '../plugins/elHeight'

const resize = (ctx: {
  e: React.MouseEvent,
  dom: HTMLElement,
  height?: number,
  cb: Function
}) => {
  const height = ctx.height || ctx.dom.clientHeight
  const startY = ctx.e.clientY
  let resizeHeight = height
  const move = (e: MouseEvent) => {
    resizeHeight = height + e.clientY - startY
    ctx.dom.parentElement!.style.height = resizeHeight + 'px'
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', (e) => {
    window.removeEventListener('mousemove', move)
    e.stopPropagation()
    ctx.cb(resizeHeight)
  }, {once: true})
}

export function Media({element, attributes, children}: ElementProps<MediaNode>) {
  const [selected, path, store] = useSelStatus(element)
  const ref = useRef<HTMLElement>(null)
  const [state, setState] = useGetSetState({
    height: element.height,
    dragging: false,
    loadSuccess: true,
    url: '',
    selected: false,
    type: mediaType(element.url)
  })

  useLayoutEffect(() => {
    if (element.downloadUrl) {
      return
    }
    setState({type: mediaType(element.url)})
    if (state().type === 'other' && element.url?.startsWith('http')) {
      getRemoteMediaType(element.url).then(res => {
        if (res) setState({type: res})
      })
    }
    if (!['image', 'other'].includes(state().type) || element.url?.startsWith('data:')) {
      setState({loadSuccess: true, url: element.url})
      return
    }
    let realUrl = element.url
    if (realUrl && !realUrl?.startsWith('http') && !realUrl.startsWith('file:')) {
      const currentFilePath = store.webview ? store.webviewFilePath : store.openFilePath
      const file = isAbsolute(realUrl) ? element.url : join(currentFilePath || '', '..', realUrl)
      const data = getImageData(file)
      if (data) {
        realUrl = data
      }
    }
    setState({url: realUrl})
    if (state().type === 'image' || state().type === 'other') {
      const img = document.createElement('img')
      img.referrerPolicy = 'no-referrer'
      img.crossOrigin = 'anonymous'
      img.src = realUrl!
      img.onerror = (e) => {
        setState({loadSuccess: false})
      }
      img.onload = () => setState({loadSuccess: true})
    }
  }, [element.url, element.downloadUrl, store.webviewFilePath])

  const download = useCallback(async (url: string) => {
    let ext = await getRemoteMediaType(url)
    if (ext) {
      window.api.fetch(url).then(async res => {
        const buffer = await res.buffer()
        store.saveFile({
          name: nid() + '.' + ext,
          buffer: buffer.buffer
        }).then(res => {
          Transforms.setNodes(store.editor, {
            url: res, downloadUrl: null
          }, {at: path})
        }).catch(e => {
          console.log('err', e)
        })
      })
    }
  }, [path])
  useEffect(() => {
    if (!store.editor.selection) return
    if (element.downloadUrl) {
      download(decodeURIComponent(element.downloadUrl))
    }
  }, [element])
  return (
    <div
      className={'py-2 relative group'}
      contentEditable={false}
      {...attributes}
    >
      {selected &&
        <>
          {state().url?.startsWith('http') && state().type === 'image' &&
            <div
              className={'z-10 rounded border dark:border-gray-300/10 border-gray-400 absolute dark:bg-gray-900/60 bg-gray-100/80 backdrop-blur right-3 top-4 px-1 py-0.5 cursor-pointer'}
              onClick={(e) => {
                window.api.fetch(state().url).then(async res => {
                  const contentType = res.headers.get('content-type') || ''
                  const ext = contentType.split('/')[1]
                  if (ext) {
                    const buffer = await res.buffer()
                    MainApi.saveDialog({
                      filters: [{name: 'img', extensions: [ext]}],
                      properties: ['createDirectory']
                    }).then(res => {
                      if (res.filePath) {
                        writeFileSync(res.filePath, buffer)
                        MainApi.openInFolder(res.filePath)
                      }
                    })
                  }
                })
              }}
            >
              <Icon icon={'ic:round-download'} className={'dark:text-gray-200'}/>
            </div>
          }
          <div
            className={'absolute text-center w-full truncate left-0 -top-2 text-xs h-4 leading-4 dark:text-gray-500 text-gray-400'}>
            {element.url}
          </div>
        </>
      }
      <div
        className={`drag-el group cursor-default relative flex justify-center mb-2 border-2 rounded ${selected ? 'border-gray-300 dark:border-gray-300/50' : 'border-transparent'}`}
        data-be={'media'}
        style={{padding: (state().type === 'document') ? '10px 0' : undefined}}
        draggable={true}
        onContextMenu={e => {
          e.stopPropagation()
        }}
        onDragStart={e => {
          try {
            store.dragStart(e)
            store.dragEl = ReactEditor.toDOMNode(store.editor, element)
          } catch (e) {
          }
        }}
        onClick={(e) => {
          e.preventDefault()
          if (e.detail === 2) {
            Transforms.setNodes(store.editor, {height: undefined}, {at: path})
            setState({height: undefined})
          }
          EditorUtils.selectMedia(store, path)
        }}
      >
        <div
          className={'w-full h-full flex justify-center'}
          style={{height: state().height}}
        >
          {state().type === 'video' &&
            <video
              src={element.url} controls={true} className={'rounded h-full'}
              // @ts-ignore
              ref={ref}
            />
          }
          {state().type === 'audio' &&
            <audio
              controls={true} src={element.url}
              // @ts-ignore
              ref={ref}
            />
          }
          {state().type === 'document' &&
            <object
              data={element.url}
              className={'w-full h-full rounded'}
              // @ts-ignore
              ref={ref}
            />
          }
          {(state().type === 'image' || state().type === 'other') &&
            <img
              src={state().url} alt={'image'}
              referrerPolicy={'no-referrer'}
              draggable={false}
              // @ts-ignore
              ref={ref}
              className={'align-text-bottom h-full rounded border border-transparent min-w-[20px] min-h-[20px] block object-contain'}
            />
          }
          {selected &&
            <div
              draggable={false}
              className={'w-20 h-[6px] rounded-lg bg-zinc-500 dark:bg-zinc-400 absolute z-50 left-1/2 -ml-10 -bottom-[3px] cursor-row-resize'}
              onMouseDown={e => {
                e.preventDefault()
                resize({
                  e,
                  height: state().height,
                  dom: ref.current!,
                  cb: (height: number) => {
                    setState({height})
                    Transforms.setNodes(store.editor, {height}, {at: path})
                  }
                })
              }}
            />
          }
        </div>
        <span contentEditable={false}>{children}</span>
      </div>
    </div>
  )
}
