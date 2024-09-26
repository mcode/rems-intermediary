import axios from 'axios';
import { useEffect, useState, SetStateAction } from 'react';
import {
  Box,
  Card,
  CardContent,
} from '@mui/material';

import { Container } from '@mui/system';

const Register = () => {

    return (
        <div>
            <Container maxWidth='xl'>
                <Box
                    sx={{
                        width: '100%',
                        border: 1,
                        borderRadius: '5px',
                        borderWidth: 4,
                        borderColor: '#F1F3F4',
                        backgroundColor: '#E7EBEF'
                    }}
                >
                    <Card>
                        <CardContent>
                            <h2>Register New Client</h2>
                            <FormControl fullWidth>
                                <InputLabel id="demo-simple-select-label">REMS Endpiont</InputLabel>
                                <Select
                                    labelId="demo-simple-select-label"
                                    id="demo-simple-select"
                                    value={age}
                                    label="Age"
                                    onChange={handleChange}
                                    >
                                        <MenuItem value={10}>Ten</MenuItem>
                                        <MenuItem value={20}>Twenty</MenuItem>
                                        <MenuItem value={30}>Thirty</MenuItem>
                                </Select>
                            </FormControl>
                        </CardContent>
                    </Card>
                </Box>
                </Container>
            </div>
    )

};

export default Register;