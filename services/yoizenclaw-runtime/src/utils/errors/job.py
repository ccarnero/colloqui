"""Job-related exception classes."""


class JobError(Exception):
    """Base exception for job-related errors."""

    def __init__(self, message: str, job_id: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.job_id = job_id


class JobNotFoundError(JobError):
    """Raised when a job is not found."""


class JobExecutionError(JobError):
    """Raised when job execution fails."""


class JobValidationError(JobError):
    """Raised when job configuration is invalid."""


class WebhookError(JobError):
    """Raised when a webhook call fails."""

    def __init__(
        self,
        message: str,
        url: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.url = url
        self.status_code = status_code


class WebhookTimeoutError(WebhookError):
    """Raised when a webhook times out."""


class CodeExecutionError(JobError):
    """Raised when Python code execution fails."""
