// Every failing route in the API returns { error: '<sentence>' }, so
// `message` here is always something presentable to a person.
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}
