import * as commonUtils from './common'

//

const { isError } = commonUtils

//

/**
 *
 * @param {object|Error} error
 * @returns
 */

export const errorRes = (obj = 'Internal error') => ({
  status: false,
  error: isError(obj) || obj?.message ? obj.message : obj,
})

export const successRes = (data = null, expand = false) => {
  let res = {
    status: true,
  }

  if (data) {
    if (!expand) {
      res.data = data
    } else {
      res = { ...res, ...data }
    }
  }

  return res
}
