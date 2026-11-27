"""RS256-ключи ЕСА: загрузка приватного PEM, JWKS, kid.

Крипта — библиотекой Authlib (канон: auth не хэндроллим). Приватный ключ живёт
файлом вне репозитория (``ESA_PRIVATE_KEY_FILE``).

``kid`` = RFC 7638 thumbprint публичного ключа — стабилен для данного ключа,
меняется при ротации: клиенты с офлайн-JWKS матчат подпись по kid и дотягивают
новый JWKS при незнакомом kid.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any, Dict

from authlib.jose import JsonWebKey

from ..config import get_private_key_file

logger = logging.getLogger(__name__)


class EsaKeyError(RuntimeError):
    """Приватный ключ подписи недоступен/невалиден."""


@lru_cache(maxsize=1)
def _load_private_jwk():
    """Прочитать приватный PEM и вернуть authlib JsonWebKey (RSA).

    lru_cache: файл читается один раз на процесс. Ротация ключа = замена
    файла + рестарт сервисов (осознанно: ротация и так требует выкладки
    нового JWKS клиентам заранее).
    """
    path = get_private_key_file()
    try:
        with open(path, "rb") as f:
            pem = f.read()
    except OSError as e:
        raise EsaKeyError(f"cannot read private key file {path}: {e}") from e
    try:
        key = JsonWebKey.import_key(pem, {"kty": "RSA", "use": "sig", "alg": "RS256"})
    except Exception as e:  # authlib кидает разные типы на кривом PEM
        raise EsaKeyError(f"invalid RS256 private key in {path}: {e}") from e
    return key


def get_signing_key():
    """Приватный JWK для подписи id_token/access (RS256)."""
    return _load_private_jwk()


def get_kid() -> str:
    """kid ключа: RFC 7638 thumbprint (детерминирован по ключу)."""
    key = _load_private_jwk()
    return key.kid or key.thumbprint()


def get_public_jwks() -> Dict[str, Any]:
    """Публичный JWKS-документ для ``/.well-known/jwks.json``.

    Только публичная часть (as_dict(private=False)); клиенты кэшируют его
    для офлайн-валидации id_token.
    """
    key = _load_private_jwk()
    pub = key.as_dict(is_private=False)
    pub.setdefault("kid", get_kid())
    pub.setdefault("use", "sig")
    pub.setdefault("alg", "RS256")
    return {"keys": [pub]}


def keys_available() -> bool:
    """True, если приватный ключ читается и валиден (для health)."""
    try:
        _load_private_jwk()
        return True
    except EsaKeyError as e:
        logger.warning("esa: signing key unavailable: %s", e)
        return False
