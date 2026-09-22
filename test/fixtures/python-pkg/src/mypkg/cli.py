from .core import parse, Report
from . import core
import click

def main():
    print(parse("{}"), Report(), core)
