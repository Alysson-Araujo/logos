"""Agregação dos routers da API v1."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import health, incidents, meta

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(meta.router)
api_router.include_router(incidents.router)

__all__ = ["api_router"]
