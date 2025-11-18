/**
 * Parameter Slider - Control for adjusting shader parameters
 */

import { type Component } from 'solid-js';
import { Slider } from './Slider';
import type { ShaderParameter } from '@/types/core';

interface ParameterSliderProps {
  parameter: ShaderParameter;
  value: number;
  onChange: (value: number) => void;
}

export const ParameterSlider: Component<ParameterSliderProps> = (props) => {
  return (
    <Slider
      name={props.parameter.name}
      value={props.value}
      min={props.parameter.min}
      max={props.parameter.max}
      step={props.parameter.step}
      onChange={props.onChange}
      scale="linear"
    />
  );
};
