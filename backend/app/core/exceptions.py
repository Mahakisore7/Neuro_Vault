class DomainError(Exception):
    """Base for everything the application raises deliberately.

    Services raise these and know nothing about HTTP. main.py maps each
    subtype to a status code in exactly one place — see handle_domain_error.
    """


class NotFoundError(DomainError):
    def __init__(self, entity: str, identifier: object) -> None:
        super().__init__(f"{entity} {identifier} not found")


class PermissionDeniedError(DomainError):
    def __init__(self, action: str = "perform this action") -> None:
        super().__init__(f"You do not have permission to {action}")


class ConflictError(DomainError):
    """A uniqueness or state conflict — duplicate slug, duplicate name."""


class ValidationError(DomainError):
    """A business rule violation that Pydantic cannot express."""
