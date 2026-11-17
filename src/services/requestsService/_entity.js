import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import axios from 'axios'
import FormData from 'form-data'
import qs from 'qs'
import tunnel from 'tunnel'

import config from '../../config'

import { commonUtils } from '../../utils'

import Logger from '../logger'

//
//

const { sleep, getRandomId } = commonUtils

const DEFAULT_HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json',
}

const FILE_RESPONSE_TYPES = ['stream', 'blob']
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const sharedHttpsAgent = new https.Agent({
  keepAlive: true,
  maxFreeSockets: 10,
  maxSockets: 50,
  timeout: 60000,
})

//
//

export class Request {
  /**
   * @param {string} host
   * @param {string} path
   * @param {object} [headers]
   * @param {number} [tries] if the request fails, how many times we try to re-request
   * @param {number} [timeout] ms
   */
  constructor(host, path = '/', headers = null, tries = 5, timeout = 60000) {
    this.apiHost = host
    this.apiPath = path

    this.headers = headers || {}

    this.timeout = timeout

    this.tries = tries
    this.errorTimeout = 5000 // ms

    this.httpsAgentOptions = {
      // keepAlive: true,
    }

    // replace full path from #buildUrl
    this.replaceUrl = null

    // last error from requests
    this.error = null

    // statuses which should be returned as non-critical errors
    this.notErrors = []

    // statuses which should not be retried
    this.noRetryStatuses = [400, 401, 404]
  }

  /**
   * Mutates object. Kept for backward compatibility.
   * @param {object} obj
   * @param {*[]} emptyRules
   * @returns {object}
   */
  static removeEmptyAttributes(obj, emptyRules = [undefined, null, '']) {
    Object.keys(obj).forEach(key => {
      if (emptyRules.includes(obj[key])) {
        delete obj[key]
      }
    })

    return obj
  }

  /*
   * Public API
   */

  async simpleGet(url) {
    return this._read(null, {
      apiAction: url,
      //
      deleteAcceptHeader: true,
    })
  }

  async get(url, data = null) {
    return this._read(data, {
      apiAction: url,
    })
  }

  async getFile(url, outputLocationPath) {
    return this._downloadFile(url, outputLocationPath)
  }

  async post(url, data = {}) {
    return this._create(data, {
      apiAction: url,
    })
  }

  async put(url, data = {}) {
    return this._update(data, {
      apiAction: url,
    })
  }

  async patch(url, data = {}) {
    return this._patch(data, {
      apiAction: url,
    })
  }

  async delete(url, data = {}) {
    return this._delete(data, {
      apiAction: url,
    })
  }

  async postXwwwForm(url, data = {}) {
    return this._xWwwForm(data, 'post', {
      apiAction: url,
    })
  }

  async patchXwwwForm(url, data = {}) {
    return this._xWwwForm(data, 'patch', {
      apiAction: url,
    })
  }

  async postFormData(url, data = {}) {
    return this.#query('post', data, {
      apiAction: url,
      //
      needFormData: true,
    })
  }

  /*
   * Protected-like API.
   * Kept because old code may call these methods directly.
   */

  async _read(data, options = {}) {
    return this.#query('get', data, options)
  }

  async _readImage(data) {
    return this.#query('get', data, {
      responseType: 'arraybuffer',
    })
  }

  async _readFile(data, options = {}) {
    return this.#query('get', data, {
      responseType: 'stream',
      ...options,
    })
  }

  async _downloadFile(url, outputLocationPath) {
    if (!outputLocationPath) {
      return {
        error: 'No file output location path',
      }
    }

    return this.#query('get', null, {
      replaceUrl: url,
      responseType: 'stream',
      outputLocationPath,
    })
  }

  async _create(data, options = {}) {
    return this.#query('post', data, options)
  }

  async _update(data, options = {}) {
    return this.#query('put', data, options)
  }

  async _delete(data, options = {}) {
    return this.#query('delete', data, options)
  }

  async _patch(data, options = {}) {
    return this.#query('patch', data, options)
  }

  async _xWwwForm(data, method = 'post', options = {}) {
    return this.#query(method, data, {
      ...options,
      needXwwwForm: true,
    })
  }

  /*
   * Core request executor
   */

  async #query(method, dataRaw = null, queryOptions = {}) {
    const requestId = await getRandomId()
    const startRequest = Date.now()

    const requestData = this.#buildRequestData(method, dataRaw, queryOptions)

    const enabledProxy = this.#isProxyEnabled(requestData.url)
    const httpsAgent = this.#buildHttpsAgent(enabledProxy)

    const options = {
      method,
      url: requestData.url,
      headers: requestData.headers,
      data: requestData.data,
      timeout: this.timeout,
      httpsAgent,
      maxRedirects: 0,
      responseType: queryOptions?.responseType || 'json',
      maxBodyLength: MAX_RESPONSE_BYTES,
      maxContentLength: MAX_RESPONSE_BYTES,
    }

    Logger.info?.('REQUEST', {
      request: {
        serviceAPI: this.constructor.name,
        method: options.method.toUpperCase(),
        url: this.#safeUrl(options.url),
        headerNames: Object.keys(options.headers),
        hasBody: options.data !== null,
        requestId,
      },
    })

    // Fallback for old Logger versions where info may not exist.
    if (!Logger.info) {
      Logger.debug('REQUEST', {
        request: {
          serviceAPI: this.constructor.name,
          method: options.method.toUpperCase(),
          url: this.#safeUrl(options.url),
          headerNames: Object.keys(options.headers),
          hasBody: options.data !== null,
          requestId,
        },
      })
    }

    let errorsCounter = 0
    let res = null

    do {
      try {
        res = await axios(options)

        Logger.debug('REQUEST - Success', {
          request: {
            status: res.status,
            contentLength: res.headers?.['content-length'] || null,
            responseType: options.responseType,
            requestId,
            time: `${Date.now() - startRequest} ms`,
          },
        })
      } catch (err) {
        errorsCounter += 1

        const errorObj = this.#normalizeAxiosError(err)

        this.error = errorObj
        this.error.notError = this.notErrors.includes(this.error.status)

        const shouldRetry = this.#shouldRetry(errorObj, errorsCounter)

        if (
          this.#shouldLogError(options, errorObj, errorsCounter, shouldRetry)
        ) {
          Logger.error('REQUEST - Error', {
            request: {
              options: JSON.stringify({
                url: this.#safeUrl(options.url),
                method: options.method,
                headerNames: Object.keys(options.headers),
                hasBody: options.data !== null,
              }),
              message: errorObj.message,
              status: errorObj.status,
              description: errorObj.description,
              requestId,
              time: `${Date.now() - startRequest} ms`,
              stack: errorObj.stack,
              errorsCounter,
              willRetry: shouldRetry,
            },
          })
        }

        if (!shouldRetry) {
          break
        }

        await sleep(this.errorTimeout)
      }
    } while (!res && errorsCounter < this.tries)

    Logger.debug('REQUEST - Finished', {
      request: {
        requestId,
        //
        content: res?.data ?? null,
        //
        time: `${Date.now() - startRequest} ms`,
      },
      errorsCounter,
    })

    if (!res) {
      return {
        error: this.error,
      }
    }

    if (this.#shouldWriteResponseToFile(queryOptions)) {
      return this.#writeResponseToFile(res, queryOptions, requestId)
    }

    return {
      content: res.data,
      status: res.status,
      headers: res.headers,
    }
  }

  /*
   * Request building
   */

  #buildRequestData(method, dataRaw, queryOptions) {
    let url
    let data = null

    const headers = {
      ...DEFAULT_HEADERS,
    }

    if (method === 'get') {
      const optionsPath = this.#buildOptionsPath(dataRaw)

      if (queryOptions?.paramsString) {
        url = `${this.#buildUrl(queryOptions.apiAction)}${queryOptions.paramsString}`
      } else {
        url =
          queryOptions?.replaceUrl ||
          `${this.#buildUrl(queryOptions.apiAction)}${optionsPath}`
      }
    } else {
      url = queryOptions?.replaceUrl || this.#buildUrl(queryOptions.apiAction)

      const body = this.#buildRequestBody(dataRaw, queryOptions)

      data = body.data

      Object.assign(headers, body.headers)
    }

    if (queryOptions?.deleteAcceptHeader) {
      delete headers.accept
    }

    const finalHeaders = this.#buildFinalHeaders(headers, method, queryOptions)

    return {
      url,
      data,
      headers: finalHeaders,
    }
  }

  #buildRequestBody(dataRaw, queryOptions) {
    const headers = {}

    if (dataRaw === null || typeof dataRaw === 'undefined') {
      delete headers['content-type']

      return {
        data: null,
        headers,
      }
    }

    if (typeof dataRaw === 'string') {
      headers['content-type'] = 'application/x-www-form-urlencoded'

      return {
        data: dataRaw,
        headers,
      }
    }

    if (queryOptions?.needBuffer) {
      headers['content-type'] = queryOptions.type

      return {
        data: dataRaw.buffer,
        headers,
      }
    }

    if (queryOptions?.needFormData) {
      const form = this.#normalizeFormData(dataRaw)

      return {
        data: form,
        headers: form.getHeaders(),
      }
    }

    if (queryOptions?.needXwwwForm) {
      headers['content-type'] = 'application/x-www-form-urlencoded'

      return {
        data: qs.stringify(dataRaw),
        headers,
      }
    }

    const json = JSON.stringify(dataRaw)

    headers['content-type'] = 'application/json'
    headers['content-length'] = Buffer.byteLength(json)

    return {
      data: json,
      headers,
    }
  }

  #normalizeFormData(dataRaw) {
    if (dataRaw instanceof FormData) {
      return dataRaw
    }

    const form = new FormData()

    Object.entries(dataRaw || {}).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach(item => {
          form.append(key, item)
        })

        return
      }

      form.append(key, value)
    })

    return form
  }

  #buildFinalHeaders(headers, method, queryOptions) {
    const finalHeaders = {
      ...headers,
      ...this.headers,
      'content-length':
        headers?.['content-length'] || this.headers?.['content-length'],
      ...(queryOptions?.headers || {}),
    }

    if (!finalHeaders['content-length']) {
      delete finalHeaders['content-length']
    }

    if (
      finalHeaders['content-type'] === 'application/json' &&
      method === 'get'
    ) {
      delete finalHeaders['content-type']
    }

    return finalHeaders
  }

  /*
   * Proxy / agent
   */

  #isProxyEnabled(url) {
    return (
      config.serverSettings?.requests?.proxy?.enabled &&
      !url.includes('.local/')
    )
  }

  #buildHttpsAgent(enabledProxy) {
    const httpsAgentOptions = {
      ...this.httpsAgentOptions,
    }

    if (!enabledProxy) {
      if (Object.keys(this.httpsAgentOptions).length === 0) {
        return sharedHttpsAgent
      }

      return new https.Agent({ keepAlive: true, ...httpsAgentOptions })
    }

    //
    //

    return tunnel.httpsOverHttp({
      proxy: {
        host: config.serverSettings.requests.proxy.host,
        port: +config.serverSettings.requests.proxy.port,
        proxyAuth: `${config.serverSettings.requests.proxy.login}:${config.serverSettings.requests.proxy.password}`,
      },
      ...httpsAgentOptions,
    })
  }

  /*
   * Retry / error handling
   */

  #normalizeAxiosError(err) {
    if (err.response) {
      const errorObj = new Error('Failed request')

      errorObj.data = err.response.data
      errorObj.status = err.response.status
      errorObj.headers = err.response.headers

      return errorObj
    }

    if (err.request) {
      const errorObj = new Error(err.message)

      errorObj.status = 504
      errorObj.code = err.code

      return errorObj
    }

    const errorObj = new Error('Unknown request error')

    errorObj.description = err.message
    errorObj.stack = err.stack

    return errorObj
  }

  #shouldRetry(errorObj, errorsCounter) {
    if (errorsCounter >= this.tries) {
      return false
    }

    if (this.notErrors.includes(errorObj.status)) {
      return false
    }

    if (this.noRetryStatuses.includes(errorObj.status)) {
      return false
    }

    return true
  }

  #shouldLogError(options, errorObj, errorsCounter, shouldRetry) {
    if (options.url.includes('?entryPoint=image')) {
      return false
    }

    if (options.responseType === 'stream') {
      return false
    }

    if (this.notErrors.includes(errorObj.status)) {
      return false
    }

    if (config.isDebug) {
      return true
    }

    // Log only final failed attempt, or non-retryable errors.
    return !shouldRetry || errorsCounter >= this.tries
  }

  /*
   * File handling
   */

  #shouldWriteResponseToFile(queryOptions) {
    return Boolean(
      queryOptions?.outputLocationPath &&
      FILE_RESPONSE_TYPES.includes(queryOptions?.responseType),
    )
  }

  async #writeResponseToFile(res, queryOptions, requestId) {
    try {
      await fs.promises.mkdir(path.dirname(queryOptions.outputLocationPath), {
        recursive: true,
      })

      await pipeline(
        res.data,
        fs.createWriteStream(queryOptions.outputLocationPath),
      )

      return {
        path: queryOptions.outputLocationPath,
        status: res.status,
        headers: res.headers,
      }
    } catch (error) {
      Logger.error('REQUEST - File Download Error', {
        request: {
          requestId,
          path: queryOptions.outputLocationPath,
        },
        error: {
          message: error.message,
          stack: error.stack,
        },
      })

      return {
        error,
      }
    }
  }

  /*
   * URL helpers
   */

  #buildOptionsPath(data, withStart = true) {
    if (!data || !Object.keys(data).length) {
      return ''
    }

    return `${withStart ? '?' : ''}${qs.stringify(data)}`
  }

  #buildUrl(apiAction) {
    return (
      this.replaceUrl ||
      `${this.apiHost}${this.apiPath || ''}${apiAction || ''}`
    )
  }

  #safeUrl(value) {
    try {
      const url = new URL(value)

      return `${url.origin}${url.pathname}`
    } catch {
      return '*invalid_url*'
    }
  }
}

export const closeRequestAgents = () => {
  sharedHttpsAgent.destroy()
}

export default Request
