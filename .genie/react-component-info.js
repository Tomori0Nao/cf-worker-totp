

/**
 * @typedef {import('./types').ClickToComponentProps} Props
 * @typedef {import('./types').Coords} Coords
 */

import { html } from "htm/react"
import * as React from "react"

/**
 * WebSocket客户端连接类
 * 用于与PreviewRouteService服务通信
 */
class PreviewRouteClient {
	// 检查WebSocket是否可用
	static isWebSocketAvailable() {
		return typeof WebSocket !== "undefined"
	}
	constructor(port = 3010, path = "/") {
		this.port = port
		this.path = path
		this.ws = null
		this.isConnected = false
		this.reconnectTimer = null
		this.reconnectInterval = 5000 // 5秒重连间隔
		this.connect()
	}

	connect() {
		// 检查WebSocket是否可用
		if (!PreviewRouteClient.isWebSocketAvailable()) {
			console.error("WebSocket在当前环境中不可用")
			return
		}

		try {
			const url = `ws://localhost:${this.port}${this.path}`
			this.ws = new WebSocket(url)

			this.ws.onopen = () => {
				console.log(`已连接到WebSocket服务: ${url}`)
				this.isConnected = true

				// 发送初始连接消息
				this.sendMessage({
					type: "connection",
					data: {
						client: "click-to-component",
						timestamp: Date.now(),
					},
				})
			}

			this.ws.onclose = () => {
				console.log(`与WebSocket服务的连接已关闭，将尝试重新连接...`)
				this.isConnected = false

				// 设置重连
				if (!this.reconnectTimer) {
					this.reconnectTimer = setTimeout(() => {
						this.reconnectTimer = null
						this.connect()
					}, this.reconnectInterval)
				}
			}

			this.ws.onerror = (error) => {
				console.error(`WebSocket连接错误:`, error)
			}
		} catch (error) {
			console.error(`创建WebSocket连接失败:`, error)
		}
	}

	sendMessage(message) {
		if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.warn("WebSocket未连接，无法发送消息")
			return false
		}

		try {
			this.ws.send(JSON.stringify(message))
			return true
		} catch (error) {
			console.error("发送消息失败:", error)
			return false
		}
	}

	close() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}

		if (this.ws) {
			this.ws.close()
			this.ws = null
		}

		this.isConnected = false
	}
}

// 创建WebSocket客户端连接
const wsClient = new PreviewRouteClient(3010, "/") // 暂时设置为3010，应该设置为可以修改的参数

export const State = /** @type {const} */ ({
	IDLE: "IDLE",
	HOVER: "HOVER",
	SELECT: "SELECT",
})

/**
 * @param {Props} props
 */
export function ClickToComponent({ editor = "vscode", pathModifier }) {
	const [state, setState] = React.useState(
		/** @type {State[keyof State]} */
		(State.IDLE),
	)

	const [target, setTarget] = React.useState(
		/** @type {HTMLElement | null} */
		(null),
	)

	const onClick = React.useCallback(
		function handleClick(
			/**
			 * @type {MouseEvent}
			 */
			event,
		) {
			if (state === State.HOVER && target instanceof HTMLElement) {
				const instance = getReactInstancesForElement(target).find((instance) => getSourceForInstance(instance))

				console.log("instance", instance)
				if (!instance) {
					return console.warn("Could not find React instance for element", target)
				}

				const source = getSourceForInstance(instance)

				if (!source) {
					return console.warn("Could not find source for React instance", instance)
				}

				console.log(`source: ${source}, pathModifier: ${pathModifier}`)

				// 准备要发送的数据
				const componentData = {
					componentName: getDisplayNameForInstance(instance),
					columnNumber: source.columnNumber,
					filePath: source.fileName,
					lineNumber: source.lineNumber,
				}

				// 通过WebSocket发送数据
				wsClient.sendMessage({
					type: "componentClick",
					data: componentData,
				})
				console.log("已发送组件数据:", componentData)

				event.preventDefault()

				setState(State.IDLE)
			}
		},
		[editor, pathModifier, state, target],
	)

	const onClose = React.useCallback(
		function handleClose(returnValue) {
			setState(State.IDLE)
		},
		[editor],
	)

	const onKeyDown = React.useCallback(
		function handleKeyDown(
			/**
			 * @type {KeyboardEvent}
			 */
			event,
		) {
			switch (state) {
				case State.IDLE:
					if (event.altKey) setState(State.HOVER)
					break

				default:
			}
		},
		[state],
	)

	const onKeyUp = React.useCallback(
		function handleKeyUp(
			/**
			 * @type {KeyboardEvent}
			 */
			event,
		) {
			switch (state) {
				case State.HOVER:
					setState(State.IDLE)
					break

				default:
			}
		},
		[state],
	)

	const onMouseMove = React.useCallback(
		function handleMouseMove(
			/** @type {MouseEvent} */
			event,
		) {
			if (!(event.target instanceof HTMLElement)) {
				return
			}

			switch (state) {
				case State.IDLE:
				case State.HOVER:
					setTarget(event.target)
					break

				default:
					break
			}
		},
		[state],
	)

	const onBlur = React.useCallback(
		function handleBlur() {
			switch (state) {
				case State.HOVER:
					setState(State.IDLE)
					break

				default:
			}
		},
		[state],
	)

	React.useEffect(
		function toggleIndicator() {
			// 移除现有的信息块
			const existingInfo = document.querySelector(".click-to-component-info")
			if (existingInfo) {
				existingInfo.remove()
			}

			// 清除现有的目标标记
			for (const element of Array.from(document.querySelectorAll("[data-click-to-component-target]"))) {
				if (element instanceof HTMLElement) {
					delete element.dataset.clickToComponentTarget
				}
			}

			if (state === State.IDLE) {
				delete window.document.body.dataset.clickToComponent
				if (target) {
					delete target.dataset.clickToComponentTarget
				}
				return
			}

			if (target instanceof HTMLElement) {
				window.document.body.dataset.clickToComponent = state
				target.dataset.clickToComponentTarget = state

				// 创建并添加信息块
				const infoElement = document.createElement("div")
				infoElement.className = "click-to-component-info"

				// 获取要显示的信息
				const instance = getReactInstancesForElement(target).find((instance) => getSourceForInstance(instance))

				let infoText = "未知组件"
				if (instance) {
					// 获取组件名称
					const name = "<" + getDisplayNameForInstance(instance) + ">"

					// 获取文件路径
					const source = getSourceForInstance(instance)
					const filePath = source ? source.fileName.split("/").pop() : ""

					infoText = `${name} (${filePath})`
				}

				infoElement.textContent = infoText
				document.body.appendChild(infoElement)

				// 定位信息块
				const rect = target.getBoundingClientRect()
				const top = rect.top > 40 ? rect.top - 30 : rect.bottom + 5

				infoElement.style.left = `${rect.left}px`
				infoElement.style.top = `${top}px`
			}
		},
		[state, target],
	)

	React.useEffect(
		function addEventListenersToWindow() {
			window.addEventListener("click", onClick, { capture: true })
			window.addEventListener("keydown", onKeyDown)
			window.addEventListener("keyup", onKeyUp)
			window.addEventListener("mousemove", onMouseMove)
			window.addEventListener("blur", onBlur)

			return function removeEventListenersFromWindow() {
				window.removeEventListener("click", onClick, { capture: true })
				window.removeEventListener("keydown", onKeyDown)
				window.removeEventListener("keyup", onKeyUp)
				window.removeEventListener("mousemove", onMouseMove)
				window.removeEventListener("blur", onBlur)
			}
		},
		[onClick, onKeyDown, onKeyUp, onMouseMove, onBlur],
	)

	// 组件卸载时关闭WebSocket连接
	React.useEffect(() => {
		return () => {
			if (wsClient) {
				wsClient.close()
			}
		}
	}, [])

	return html`
		<style key="click-to-component-style">
			[data-click-to-component] * {
				pointer-events: auto !important;
			}

			[data-click-to-component-target] {
				cursor: var(--click-to-component-cursor, context-menu) !important;
				outline: auto 1px #32e6b9;
				outline: var(--click-to-component-outline, #32e6b9 auto 1px) !important;
			}

			/* 信息块样式 */
			.click-to-component-info {
				position: absolute;
				background-color: #32e6b9;
				color: white;
				padding: 4px 8px;
				border-radius: 4px;
				font-size: 12px;
				font-family: monospace;
				pointer-events: none;
				z-index: 2147483647;
				max-width: 300px;
				word-break: break-word;
				box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
			}
		</style>
	`
}

/**
 * @typedef {import('react-reconciler').Fiber} Fiber
 * @param {Fiber} instance
 */
export function getDisplayNameForInstance(instance) {
	const { elementType, tag } = instance

	// https://github.com/facebook/react/blob/7c8e5e7ab8bb63de911637892392c5efd8ce1d0f/packages/react-reconciler/src/ReactWorkTags.js
	switch (tag) {
		case 0: // FunctionComponent
		case 1: // ClassComponent
			return elementType.displayName || elementType.name || "Anonymous Component"

		case 3:
			return "HostRoot"

		case 4:
			return "HostPortal"

		case 5: // HostComponent:
			return elementType

		case 6: // HostText:
			return "String"

		case 7: // Fragment
			return "React.Fragment"

		case 8:
			return "Mode"

		case 9: // ContextConsumer
			return "Context.Consumer"

		case 10: // ContextProvider
			return "Context.Provider"

		case 11: // ForwardRef
			return "React.forwardRef"

		case 12:
			return "Profiler"

		case 13:
			return "SuspenseComponent"

		case 14:
			return "MemoComponent"

		case 15: // SimpleMemoComponent
			// Attempt to get name from wrapped component
			return elementType.type.name ?? "MemoComponent"

		case 16: // LazyComponent
			return "React.lazy"

		case 17:
			return "IncompleteClassComponent"

		case 18:
			return "DehydratedFragment"

		case 19:
			return "SuspenseListComponent"

		case 21:
			return "ScopeComponent"

		case 22:
			return "OffscreenComponent"

		case 23:
			return "LegacyHiddenComponent"

		case 24:
			return "CacheComponent"

		// @ts-expect-error Type '25' is not comparable to type 'WorkTag'.ts(2678)
		case 25:
			return "TracingMarkerComponent"

		// @ts-expect-error Type '26' is not comparable to type 'WorkTag'.ts(2678)
		case 26:
			return "HostHoistable"

		// @ts-expect-error Type '27' is not comparable to type 'WorkTag'.ts(2678)
		case 27:
			return "HostSingleton"

		// @ts-expect-error Type '28' is not comparable to type 'WorkTag'.ts(2678)
		case 28:
			return "IncompleteFunctionComponent"

		// @ts-expect-error Type '29' is not comparable to type 'WorkTag'.ts(2678)
		case 29:
			return "Throw"

		default:
			console.warn(`Unrecognized React Fiber tag: ${tag}`, instance)
			return "Unknown Component"
	}
}

/**
 * @typedef {import('react-reconciler').Source} Source
 * @typedef {import('./types').PathModifier} PathModifier
 */

/**
 * @param {Source} source
 * @param {PathModifier} pathModifier
 */
export function getPathToSource(source, pathModifier) {
	const {
		// It _does_ exist!
		// @ts-ignore Property 'columnNumber' does not exist on type 'Source'.ts(2339)
		columnNumber = 1,
		fileName,
		lineNumber = 1,
	} = source

	let path = `${fileName}:${lineNumber}:${columnNumber}`
	if (pathModifier) {
		path = pathModifier(path)
	}

	return path
}

/**
 * @typedef {import('react-reconciler').Fiber} Fiber
 */

export function getReactInstancesForElement(
	/** @type {HTMLElement} */
	element,
) {
	/** @type {Set<Fiber>} */
	const instances = new Set()
	let instance = getReactInstanceForElement(element)

	while (instance) {
		instances.add(instance)

		instance = instance._debugOwner
	}

	return Array.from(instances)
}

/**
 * @param {HTMLElement} element
 */
export function getReactInstanceForElement(element) {
	// Prefer React DevTools, which has direct access to `react-dom` for mapping `element` <=> Fiber
	if ("__REACT_DEVTOOLS_GLOBAL_HOOK__" in window) {
		// @ts-expect-error - TS2339 - Property '__REACT_DEVTOOLS_GLOBAL_HOOK__' does not exist on type 'Window & typeof globalThis'.
		const { renderers } = window.__REACT_DEVTOOLS_GLOBAL_HOOK__

		for (const renderer of renderers.values()) {
			try {
				const fiber = renderer.findFiberByHostInstance(element)

				if (fiber) {
					return fiber
				}
			} catch (e) {
				// If React is mid-render, references to previous nodes may disappear during the click events
				// (This is especially true for interactive elements, like menus)
			}
		}
	}

	if ("_reactRootContainer" in element) {
		// @ts-expect-error - TS2339 - Property '_reactRootContainer' does not exist on type 'HTMLElement'.
		return element._reactRootContainer._internalRoot.current.child
	}

	// eslint-disable-next-line guard-for-in
	for (const key in element) {
		// Pre-Fiber access React internals
		if (key.startsWith("__reactInternalInstance$")) {
			return element[key]
		}

		// Fiber access to React internals
		if (key.startsWith("__reactFiber")) {
			return element[key]
		}
	}
}

/**
 * @typedef {import('react-reconciler').Fiber} Fiber
 * @typedef {import('react-reconciler').Source} Source
 */

/**
 * @param {Fiber} instance
 */
export function getSourceForInstance(instance) {
	if (!instance._debugSource) {
		return
	}

	const {
		// It _does_ exist!
		// @ts-ignore Property 'columnNumber' does not exist on type 'Source'.ts(2339)
		columnNumber = 1,
		fileName,
		lineNumber = 1,
	} = instance._debugSource

	return { columnNumber, fileName, lineNumber }
}
