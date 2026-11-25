import { HttpError } from '../http.mjs';

export class DocumentError extends HttpError {
  constructor(status, code, message) {
    super(status, message);
    this.code = code;
  }
}
