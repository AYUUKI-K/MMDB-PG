export class ApiError extends Error {
  constructor(status,message,code='invalid_request'){super(message);this.status=status;this.code=code;}
}
export const bad=message=>{throw new ApiError(400,message);};
